// -----------------------------------------------------------------------------
// A fake Miniserver, at the boundary of loxone-ts-api: `Client` has the surface
// of its LoxoneClient (connect, getStructureFile, enableUpdates, control,
// sendTextCommand, disconnect, the events and the token), `fetch` answers the
// unauthenticated jdev/cfg/apiKey request. Failures are logged through
// node-ansi-logger with the library's wording ("Could not connect: …"), as the
// real client does. No network.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { AnsiLogger } from 'node-ansi-logger';
import {
  FIRMWARE,
  LAST_MODIFIED,
  PASSWORD,
  SERIAL,
  USER,
  initialValues,
  structure,
} from '../fixtures/loxone.js';

/** Lets the pending promises and timers of the current tick run. */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await Promise.resolve();
  }
};

export function fakeMiniserver({
  structureData = structure(),
  values = initialValues(),
  version = FIRMWARE,
  https = false,
  users = { [USER]: PASSWORD },
} = {}) {
  const ms = {
    structure: structureData,
    values,
    version,
    https,
    users,
    /** network: 'up' | 'down' | 'rebooting' | 'html' */
    network: 'up',
    /** a login refused with this text at the "connected" step (e.g. a 4003 close) */
    refuseWith: undefined,
    tokens: new Set(),
    killed: [],
    issued: 0,
    clients: [],
    commands: [],
    probes: [],
    /** (uuid, command) -> void: the Miniserver's reaction to a command */
    onCommand: undefined,
    /** (uuid, command) -> { code, value } to answer something else than 200 */
    answer: undefined,
  };

  ms.fetch = async (url) => {
    ms.probes.push(String(url));
    if (ms.network === 'down') {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    if (ms.network === 'rebooting') {
      return { status: 503, ok: false, headers: new Map(), text: async () => '' };
    }
    if (ms.network === 'html') {
      return { status: 200, ok: true, headers: new Map(), text: async () => '<html></html>' };
    }
    const value = `{'snr': '${SERIAL.match(/../g).join(':')}', 'version':'${ms.version}', 'key':'abcd', 'isInTrust':false, 'local':true, 'httpsStatus':${ms.https ? 1 : 0}}`;
    return {
      status: 200,
      ok: true,
      headers: new Map(),
      text: async () => JSON.stringify({ LL: { control: 'dev/cfg/apiKey', value, Code: '200' } }),
    };
  };

  /** The clients that are connected and streaming. */
  const live = () => ms.clients.filter((c) => c.state === 'ready' && c.updates);

  /** A state changes on the Miniserver: the streaming clients get the event. */
  ms.set = (uuid, value) => {
    ms.values.set(uuid, value);
    for (const client of live()) {
      client.send(uuid, value);
    }
  };

  /** The socket of every client closes (network cut, Miniserver reboot). */
  ms.drop = (reason = 'Closed with code 1006, reason: ') => {
    for (const client of ms.clients.filter((c) => c.state === 'ready')) {
      client.lose(reason);
    }
  };

  ms.last = () => ms.clients.at(-1);

  class FakeLoxoneClient extends EventEmitter {
    constructor(address, username, password, options) {
      super();
      this.address = address;
      this.username = username;
      this.password = password;
      this.options = options;
      this.state = 'disconnected';
      this.updates = false;
      this.structureFile = undefined;
      this.auth = { tokenHandler: { token: undefined } };
      this.log = new AnsiLogger({ logName: 'LoxoneClient', logLevel: options?.logLevel });
      const client = this;
      // The library's message handler throws on a frame it does not expect.
      this.webSocketConnection = {
        handleMessage(data, isBinary) {
          if (!isBinary) {
            throw new Error('Expected binary data for header');
          }
        },
        cleanupAfterDisconnectOrError(reason) {
          client.lose(reason);
        },
      };
      ms.clients.push(this);
    }

    setState(state) {
      if (this.state !== state) {
        this.state = state;
        this.emit('stateChanged', state);
      }
    }

    fail(message) {
      this.log.error(`Could not connect: ${message}`);
      this.setState('error');
    }

    async connect(token) {
      this.setState('connecting');
      await Promise.resolve();
      if (ms.network !== 'up') {
        return this.fail('fetch failed');
      }
      this.setState('connected');
      this.emit('connected');
      this.setState('authenticating');
      if (ms.refuseWith) {
        return this.fail(ms.refuseWith);
      }
      if (token) {
        if (!ms.tokens.has(token)) {
          return this.fail('Failed to authenticate with existing token: 401');
        }
        this.auth.tokenHandler.token = token;
      } else {
        if (ms.users[this.username] === undefined) {
          return this.fail('Failed to getkey2: 404');
        }
        if (ms.users[this.username] !== this.password) {
          return this.fail('Failed to acquire JWT: 401');
        }
        ms.issued += 1;
        const issued = `jwt-${ms.issued}`;
        ms.tokens.add(issued);
        this.auth.tokenHandler.token = issued;
      }
      this.setState('authenticated');
      this.emit('authenticated');
      this.setState('ready');
      this.emit('ready');
      return undefined;
    }

    requireReady() {
      if (this.state !== 'ready') {
        throw new Error('Client is not in an expected state - not ready');
      }
    }

    async getStructureFile() {
      this.requireReady();
      this.structureFile = structuredClone(ms.structure);
      return this.structureFile;
    }

    async enableUpdates() {
      this.requireReady();
      this.updates = true;
      for (const [uuid, value] of ms.values) {
        this.send(uuid, value);
      }
    }

    send(uuid, value) {
      const event = { uuid: { stringValue: uuid } };
      if (typeof value === 'string') {
        this.emit('event_text', { ...event, text: value });
      } else {
        this.emit('event_value', { ...event, value });
      }
    }

    async sendTextCommand(command) {
      this.requireReady();
      if (command === 'jdev/sps/LoxAPPversion3') {
        return { code: 200, value: ms.structure.lastModified ?? LAST_MODIFIED };
      }
      return { code: 404, value: '' };
    }

    async control(uuid, command) {
      this.requireReady();
      ms.commands.push([uuid, command]);
      const answer = ms.answer?.(uuid, command) ?? { code: 200, value: '1' };
      if (answer.code !== 200 || answer.value === '0') {
        const err = new Error(`${uuid}/${command} - response was not 200 OK`);
        err.name = 'LoxoneControlError';
        err.response = answer;
        throw err;
      }
      ms.onCommand?.(uuid, command);
      return answer;
    }

    lose(reason) {
      if (this.state === 'disconnected') {
        return;
      }
      this.updates = false;
      this.setState('disconnected');
      this.emit('disconnected', reason);
    }

    async disconnect(preserveToken = false) {
      const token = this.auth.tokenHandler.token;
      if (!preserveToken && token && this.state === 'ready') {
        ms.tokens.delete(token);
        ms.killed.push(token);
      }
      this.setState('disconnecting');
      this.lose('Disconnect initiated');
    }
  }

  ms.Client = FakeLoxoneClient;
  return ms;
}
