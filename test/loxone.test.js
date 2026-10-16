// -----------------------------------------------------------------------------
// The wrapper of loxone-ts-api: the probe, the failure kinds, the log routing,
// the message guard — partly against the real library classes (constructed
// only: they open no connection before connect()).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import LoxoneClient, { LoxoneControlError } from 'loxone-ts-api';
import LoxoneValueEvent from 'loxone-ts-api/dist/LoxoneEvents/LoxoneValueEvent.js';
import TextMessage from 'loxone-ts-api/dist/WebSocketMessages/TextMessage.js';
import { LogLevel } from 'node-ansi-logger';
import { TIMINGS } from '../src/constants.js';
import {
  Connection,
  LoxoneError,
  clientUuidOf,
  commandError,
  connectFailure,
  firmwareOk,
  guardMessages,
  parseApiKey,
  probe,
  routeLibraryLogs,
} from '../src/loxone.js';
import { uuidKey } from '../src/structure.js';
import { C, PASSWORD, USER } from './fixtures/loxone.js';
import { fakeMiniserver, settle } from './helpers/fakeLoxone.js';

const ORIGIN = 'http://192.168.1.77';

test('probe: the apiKey answer, the network and HTTP failures', async () => {
  const ms = fakeMiniserver();
  assert.deepEqual(await probe(ORIGIN, { fetch: ms.fetch }), {
    serial: '50:4F:94:A0:B1:C2',
    version: '15.2.10.14',
    https: false,
    local: true,
  });
  assert.equal(ms.probes[0], 'http://192.168.1.77/jdev/cfg/apiKey');
  const kind = async (fetch) => (await probe(ORIGIN, { fetch }).catch((e) => e)).kind;
  ms.network = 'down';
  assert.equal(await kind(ms.fetch), 'unreachable');
  ms.network = 'rebooting';
  assert.equal(await kind(ms.fetch), 'rebooting');
  ms.network = 'html';
  assert.equal(await kind(ms.fetch), 'format');
  const certificate = async () => {
    throw new TypeError('fetch failed', {
      cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: 'Hostname/IP does not match' },
    });
  };
  assert.equal(await kind(certificate), 'certificate');
  const timeout = async () => {
    throw Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
  };
  assert.equal(await kind(timeout), 'unreachable');
  const redirect = async () => ({
    status: 302,
    ok: false,
    headers: new Map([['location', 'https://x']]),
  });
  const err = await probe(ORIGIN, { fetch: redirect }).catch((e) => e);
  assert.deepEqual([err.kind, err.message], ['redirect', 'redirected to https://x']);
  assert.equal(await kind(async () => ({ status: 404, ok: false, headers: new Map() })), 'http');
  assert.equal(await kind(fakeMiniserver({ version: '9.3.2.20' }).fetch), 'firmware');
});

test('the apiKey format and the firmware check', () => {
  const body = (value, code = '200') =>
    JSON.stringify({ LL: { control: 'dev/cfg/apiKey', value, Code: code } });
  assert.equal(
    parseApiKey(body("{'snr': 'x', 'version':'12.0.2.24', 'httpsStatus':2}")).https,
    true,
  );
  assert.equal(parseApiKey(body("{'version':'12.0'}", '500')), undefined);
  assert.equal(parseApiKey(body('not json')), undefined);
  assert.equal(parseApiKey('<html>'), undefined);
  assert.equal(firmwareOk('11.2.1.2'), true);
  assert.equal(firmwareOk('11.1.9.3'), false);
  assert.equal(firmwareOk('16.0.6.10'), true);
  assert.equal(firmwareOk('x'), false);
});

test('why connect() failed: the states it went through and its log line', () => {
  const auth = ['connecting', 'connected', 'authenticating', 'error'];
  assert.equal(connectFailure(auth, 'Failed to acquire JWT: 401').kind, 'auth');
  assert.equal(connectFailure(auth, 'Failed to getkey2: 404').kind, 'auth');
  assert.equal(
    connectFailure(auth, 'Failing pending request because Closed with code 4003, reason: ').kind,
    'blocked',
  );
  assert.equal(connectFailure(auth, 'Failed to acquire JWT: 423').kind, 'disabled');
  assert.equal(connectFailure(auth, 'Closed with code 4008').kind, 'busy');
  assert.equal(connectFailure(['connecting', 'error'], 'connect ECONNREFUSED').kind, 'unreachable');
  assert.equal(connectFailure(auth, 'No answer for command=keyexchange').kind, 'protocol');
  assert.equal(connectFailure(['connecting', 'error']).message, 'connection failed');
});

test('a failed command, in words', () => {
  const response = (code, value = '1') =>
    new TextMessage(
      JSON.stringify({ LL: { Code: String(code), control: 'jdev/sps/io/x/on', value } }),
    );
  const of = (code, value) =>
    commandError(new LoxoneControlError('x', response(code, value))).message;
  assert.match(of(404), /does not know this block/);
  assert.match(of(403), /may not control/);
  assert.match(of(423), /locked/);
  assert.match(of(200, '0'), /refused the command/);
  assert.match(of(500), /answered 500/);
  assert.equal(commandError(new Error('No answer for command=x after 15000ms')).kind, 'timeout');
});

test('the client UUID has the Loxone format and is stable', () => {
  assert.match(clientUuidOf('a'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{16}$/);
  assert.equal(clientUuidOf('a'), clientUuidOf('a'));
  assert.notEqual(clientUuidOf('a'), clientUuidOf('b'));
});

test('the real library: event UUIDs match the structure file, the guard fits its socket', () => {
  // A value event table entry: UUID (data1-3 little endian) + a double.
  const uuid = C.plug.states.active;
  const [d1, d2, d3, d4] = uuid.split('-');
  const le = (hex) => Buffer.from(hex, 'hex').reverse();
  const buffer = Buffer.concat([le(d1), le(d2), le(d3), Buffer.from(d4, 'hex'), Buffer.alloc(8)]);
  buffer.writeDoubleLE(21.5, 16);
  const event = new LoxoneValueEvent(buffer, 0);
  assert.equal(uuidKey(event.uuid.stringValue), uuid);
  assert.equal(event.value, 21.5);

  const client = new LoxoneClient(ORIGIN, USER, PASSWORD, {
    autoReconnectEnabled: false,
    logLevel: LogLevel.NONE,
  });
  const socket = client.webSocketConnection;
  assert.throws(() => socket.handleMessage(Buffer.from('x'), false), /Expected binary data/);
  const errors = [];
  assert.equal(
    guardMessages(client, (err) => errors.push(err.message)),
    true,
  );
  let closed;
  socket.on('disconnected', (reason) => (closed = reason));
  assert.doesNotThrow(() => socket.handleMessage(Buffer.from('x'), false));
  assert.deepEqual(errors, ['Expected binary data for header']);
  assert.match(closed, /unreadable message/);
  assert.equal(
    guardMessages({}, () => {}),
    false,
    'nothing to wrap: left alone',
  );
});

test('the library log lines go to the integration logger, at debug level', () => {
  const debug = [];
  routeLibraryLogs({ debug: (line) => debug.push(line) });
  const client = new LoxoneClient(ORIGIN, USER, PASSWORD, { logLevel: LogLevel.NONE });
  return client.sendTextCommand('jdev/sps/LoxAPPversion3').then(
    () => assert.fail('not connected'),
    () => {
      assert.ok(
        debug.some((l) => /^\[loxone-ts-api\] jdev\/sps\/LoxAPPversion3 - Could not send/.test(l)),
      );
      assert.ok(
        debug.every((l) => !l.includes('\u001b[')),
        'no ANSI colors',
      );
    },
  );
});

test('Connection: login, token, events, close', async () => {
  const ms = fakeMiniserver();
  const conn = new Connection({
    origin: ORIGIN,
    username: USER,
    password: PASSWORD,
    clientUuid: clientUuidOf('t'),
    Client: ms.Client,
  });
  await conn.open();
  assert.equal(conn.token, 'jwt-1');
  const values = [];
  conn.on('value', (uuid, value) => values.push([uuid, value]));
  conn.on('text', (uuid, text) => values.push([uuid, text]));
  await conn.enableUpdates();
  assert.ok(values.some(([uuid, v]) => uuid === C.plug.states.active && v === 1));
  assert.equal(await conn.structureVersion(), '2026-10-12 18:31:07');
  assert.ok((await conn.structure()).controls);
  assert.equal(ms.last().structureFile, undefined, "the library's copy is dropped");
  // A listener that throws never reaches the library.
  conn.on('value', () => {
    throw new Error('boom');
  });
  assert.doesNotThrow(() => ms.set(C.plug.states.active, 0));
  let closed;
  conn.on('closed', (reason) => (closed = reason));
  ms.drop('Closed with code 1006, reason: ');
  assert.equal(closed, 'Closed with code 1006, reason: ');
  await assert.rejects(conn.command(C.plug.uuid, 'on'), /not connected/);
  await conn.close();
  assert.deepEqual(ms.killed, [], 'a dropped socket has no token to kill');
});

test('Connection: a refused login is closed and explained', async () => {
  const ms = fakeMiniserver();
  routeLibraryLogs(undefined);
  const conn = new Connection({
    origin: ORIGIN,
    username: USER,
    password: 'bad',
    Client: ms.Client,
  });
  const err = await conn.open().catch((e) => e);
  assert.ok(err instanceof LoxoneError);
  assert.deepEqual([err.kind, err.message], ['auth', 'Failed to acquire JWT: 401']);
  assert.equal(ms.last().state, 'disconnected');
  assert.equal(conn.client, null);
});

test('Connection: a login that never ends times out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  class Hanging extends fakeMiniserver().Client {
    connect() {
      this.setState('connecting');
      return new Promise(() => {});
    }
  }
  const conn = new Connection({
    origin: ORIGIN,
    username: USER,
    password: PASSWORD,
    Client: Hanging,
  });
  const pending = conn.open().catch((e) => e);
  await settle();
  t.mock.timers.tick(TIMINGS.commandTimeout * 4);
  const err = await pending;
  assert.equal(err.kind, 'timeout');
});

test('Connection: closing does not wait forever for the token to be killed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  class Mute extends fakeMiniserver().Client {
    disconnect(preserveToken) {
      calls.push(preserveToken);
      return preserveToken ? super.disconnect(true) : new Promise(() => {});
    }
  }
  const conn = new Connection({ origin: ORIGIN, username: USER, password: PASSWORD, Client: Mute });
  await conn.open();
  const closing = conn.close();
  await settle();
  t.mock.timers.tick(TIMINGS.closeTimeout);
  await closing;
  assert.deepEqual(calls, [false, true]);
});
