// -----------------------------------------------------------------------------
// The only network access: loxone-ts-api (andrasg, MIT), used as is, behind a
// small wrapper that fits a long-running integration:
//
// - probe(): the unauthenticated `jdev/cfg/apiKey` request, first: a precise
//   error when the Miniserver is unreachable, and its firmware checked before
//   the library sees it (the library calls process.exit(1) on a firmware
//   older than 11);
// - one LoxoneClient per connection, its own reconnection turned off: the app
//   reconnects with a fresh client (no state carried over from a broken
//   socket), reading the structure file again;
// - the library's log lines (node-ansi-logger, colored, on the console) go to
//   the integration logger at debug level instead, and the last error line
//   explains a failed connect(), which only resolves with an "error" state;
// - an exception thrown while a message is decoded closes that connection
//   (the app reconnects) instead of crashing the process.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import LoxoneClient, { LoxoneControlError } from 'loxone-ts-api';
import { AnsiLogger, LogLevel } from 'node-ansi-logger';
import { MIN_FIRMWARE, TIMINGS } from './constants.js';

export class LoxoneError extends Error {
  /**
   * @param {'unreachable' | 'certificate' | 'redirect' | 'http' | 'rebooting' | 'format' |
   *   'firmware' | 'auth' | 'blocked' | 'disabled' | 'busy' | 'timeout' | 'command' |
   *   'protocol'} kind
   */
  constructor(kind, message, options) {
    super(message, options);
    this.name = 'LoxoneError';
    this.kind = kind;
  }
}

// --- The library's log lines --------------------------------------------------------

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const RECENT = 30;
const lines = [];
let lineCount = 0;
let target;

/** Sends the log lines of loxone-ts-api to `logger` (debug), and keeps the last ones. */
export function routeLibraryLogs(logger) {
  target = logger;
  AnsiLogger.setGlobalCallback((level, _time, _name, message) => {
    const text = String(message ?? '')
      .replace(ANSI, '')
      .trim();
    lineCount += 1;
    lines.push({ n: lineCount, level, text });
    if (lines.length > RECENT) {
      lines.shift();
    }
    target?.debug?.(`[loxone-ts-api] ${text}`);
  }, LogLevel.DEBUG);
}

/** The last error line logged by the library after line `mark`. */
function lastErrorSince(mark) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (line.n <= mark) {
      break;
    }
    if (line.level === LogLevel.ERROR || line.level === LogLevel.FATAL) {
      return line.text.replace(/^Could not connect:\s*/, '');
    }
  }
  return undefined;
}

// --- Probe ---------------------------------------------------------------------------

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function networkError(err, origin) {
  const cause = err?.cause ?? err;
  const code = String(cause?.code ?? '');
  const text = String(cause?.message ?? err?.message ?? '');
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    return new LoxoneError('unreachable', `no answer from ${origin}`, { cause: err });
  }
  if (/CERT|SELF_SIGNED|ERR_TLS|SSL/i.test(code) || /certificate/i.test(text)) {
    return new LoxoneError('certificate', `certificate refused (${code || text})`, { cause: err });
  }
  if (NETWORK_CODES.has(code)) {
    return new LoxoneError('unreachable', `${code} on ${origin}`, { cause: err });
  }
  return new LoxoneError('unreachable', text || 'network error', { cause: err });
}

/** "14.5.12.7" >= 11.2? */
export function firmwareOk(version) {
  const [major, minor] = String(version ?? '')
    .split('.')
    .map(Number);
  if (!Number.isFinite(major)) {
    return false;
  }
  return major > MIN_FIRMWARE[0] || (major === MIN_FIRMWARE[0] && (minor || 0) >= MIN_FIRMWARE[1]);
}

/** The answer of jdev/cfg/apiKey: { LL: { Code: "200", value: "{'snr': …, 'version': …}" } }. */
export function parseApiKey(body) {
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  const ll = json?.LL;
  const code = String(ll?.Code ?? ll?.code ?? '');
  if (!ll || code !== '200') {
    return undefined;
  }
  let info = ll.value;
  if (typeof info === 'string') {
    try {
      info = JSON.parse(info.replace(/'/g, '"'));
    } catch {
      return undefined;
    }
  }
  if (!info || typeof info !== 'object' || !info.version) {
    return undefined;
  }
  return {
    serial: String(info.snr ?? '').trim(),
    version: String(info.version).trim(),
    https: Number(info.httpsStatus) > 0,
    local: info.local !== false,
  };
}

/**
 * Asks the Miniserver who it is, without credentials.
 * @returns {Promise<{ serial: string, version: string, https: boolean, local: boolean }>}
 */
export async function probe(
  origin,
  { fetch = globalThis.fetch, timeout = TIMINGS.probeTimeout } = {},
) {
  const url = new URL('/jdev/cfg/apiKey', origin);
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: 'manual' });
  } catch (err) {
    throw networkError(err, origin);
  }
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers?.get?.('location') ?? '';
    throw new LoxoneError('redirect', `redirected to ${location || 'another address'}`);
  }
  if (res.status === 503) {
    throw new LoxoneError('rebooting', 'the Miniserver is restarting (HTTP 503)');
  }
  if (!res.ok) {
    throw new LoxoneError('http', `HTTP ${res.status}`);
  }
  const info = parseApiKey(await res.text());
  if (!info) {
    throw new LoxoneError('format', 'not a Loxone Miniserver');
  }
  if (!firmwareOk(info.version)) {
    throw new LoxoneError('firmware', `firmware ${info.version}`);
  }
  return info;
}

// --- Connection ------------------------------------------------------------------------

/** A client UUID in the Loxone format (8-4-4-16), stable for a given seed. */
export function clientUuidOf(seed) {
  const h = createHash('sha256').update(String(seed)).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 32)}`;
}

/** Why connect() ended in the "error" state, from the states it went through and its log line. */
export function connectFailure(states, message) {
  const text = message ?? 'connection failed';
  const code = /\b(4003|4006|4008|901|423|429|420|403|401)\b/.exec(text)?.[1];
  if (code === '4003' || code === '429') {
    return new LoxoneError('blocked', text);
  }
  if (code === '423' || code === '4006') {
    return new LoxoneError('disabled', text);
  }
  if (code === '901' || code === '4008') {
    return new LoxoneError('busy', text);
  }
  const authenticating = states.includes('authenticating');
  if (authenticating && (code === '401' || code === '403' || /getkey2|JWT|token/i.test(text))) {
    return new LoxoneError('auth', text);
  }
  if (!states.includes('connected')) {
    return new LoxoneError('unreachable', text);
  }
  return new LoxoneError('protocol', text);
}

/** The error of a failed command, in words. */
export function commandError(err) {
  if (err instanceof LoxoneControlError || err?.response) {
    const code = Number(err.response?.code);
    if (code === 404) {
      return new LoxoneError('command', 'the Miniserver does not know this block any more', {
        cause: err,
      });
    }
    if (code === 401 || code === 403) {
      return new LoxoneError('command', 'this Loxone user may not control this block', {
        cause: err,
      });
    }
    if (code === 423) {
      return new LoxoneError('command', 'this block is locked in Loxone', { cause: err });
    }
    if (code === 200) {
      return new LoxoneError('command', 'the Miniserver refused the command', { cause: err });
    }
    return new LoxoneError('command', `the Miniserver answered ${code || 'an error'}`, {
      cause: err,
    });
  }
  const text = String(err?.message ?? err);
  return new LoxoneError(/No answer/i.test(text) ? 'timeout' : 'command', text, { cause: err });
}

/**
 * Wraps the message handler of the library's WebSocket connection: a message it
 * cannot decode closes the connection instead of throwing out of the socket.
 * Feature-detected: does nothing on a library without it.
 */
export function guardMessages(client, onError) {
  const socket = client?.webSocketConnection;
  if (
    !socket ||
    typeof socket.handleMessage !== 'function' ||
    typeof socket.cleanupAfterDisconnectOrError !== 'function'
  ) {
    return false;
  }
  const original = socket.handleMessage;
  socket.handleMessage = function guardedHandleMessage(data, isBinary) {
    try {
      original.call(this, data, isBinary);
    } catch (err) {
      onError(err);
      this.cleanupAfterDisconnectOrError(`unreadable message: ${err?.message ?? err}`);
    }
  };
  return true;
}

/**
 * One connection to the Miniserver. Events: `value` (stateUuid, number), `text`
 * (stateUuid, string), `closed` (reason) once it was ready.
 */
export class Connection extends EventEmitter {
  constructor({
    origin,
    username,
    password,
    clientUuid,
    Client = LoxoneClient,
    logger,
    timers = globalThis,
  }) {
    super();
    this.origin = origin;
    this.username = username;
    this.password = password;
    this.clientUuid = clientUuid;
    this.Client = Client;
    this.logger = logger;
    this.timers = timers;
    this.client = null;
    this.ready = false;
  }

  /** Our listeners must never throw into the library (it would close the socket). */
  relay(event, ...args) {
    try {
      this.emit(event, ...args);
    } catch (err) {
      this.logger?.error?.(`Loxone ${event} handler failed`, err);
    }
  }

  /** Connects and authenticates (with `token` when given, else the password). */
  async open({ token } = {}) {
    const client = new this.Client(this.origin, this.username, this.password, {
      autoReconnectEnabled: false,
      keepAliveEnabled: true,
      messageLogEnabled: false,
      logAllEvents: false,
      maintainLatestEvents: false,
      logLevel: LogLevel.NONE,
      clientUuid: this.clientUuid,
    });
    this.client = client;
    guardMessages(client, (err) =>
      this.logger?.warn?.(`Loxone: unreadable message, reconnecting (${err?.message ?? err})`),
    );
    const states = [];
    client.on('stateChanged', (state) => states.push(String(state)));
    client.on('event_value', (e) => this.relay('value', e?.uuid?.stringValue, e?.value));
    client.on('event_text', (e) => this.relay('text', e?.uuid?.stringValue, e?.text));
    client.on('error', (err) => this.logger?.debug?.(`Loxone socket error: ${err?.message}`));
    client.on('disconnected', (reason) => {
      if (this.ready && this.client === client) {
        this.ready = false;
        this.relay('closed', String(reason ?? 'disconnected'));
      }
    });
    const mark = lineCount;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('timeout'), TIMINGS.commandTimeout * 4);
    });
    const outcome = await Promise.race([client.connect(token || undefined), timeout]);
    this.timers.clearTimeout(timer);
    if (outcome === 'timeout' || client.state !== 'ready') {
      const error =
        outcome === 'timeout'
          ? new LoxoneError('timeout', 'the Miniserver did not finish the login')
          : connectFailure(states, lastErrorSince(mark));
      this.client = null;
      await client.disconnect(true).catch(() => {});
      throw error;
    }
    this.ready = true;
  }

  get token() {
    return this.client?.auth?.tokenHandler?.token;
  }

  /** The structure file (LoxAPP3.json), parsed; the library's copy is dropped. */
  async structure() {
    const client = this.requireClient();
    const raw = await client.getStructureFile();
    client.structureFile = undefined;
    if (!raw || typeof raw !== 'object' || !raw.controls) {
      throw new LoxoneError('format', 'unreadable structure file');
    }
    return raw;
  }

  /** Starts the event tables: the Miniserver sends every state, then each change. */
  async enableUpdates() {
    await this.requireClient().enableUpdates();
  }

  /** The lastModified of the structure on the Miniserver (jdev/sps/LoxAPPversion3). */
  async structureVersion() {
    const message = await this.requireClient().sendTextCommand(
      'jdev/sps/LoxAPPversion3',
      TIMINGS.commandTimeout,
    );
    return String(message?.value ?? '').trim();
  }

  /** One command to a control (jdev/sps/io/<uuid>/<command>). */
  async command(uuid, command) {
    try {
      return await this.requireClient().control(uuid, command, TIMINGS.commandTimeout);
    } catch (err) {
      throw commandError(err);
    }
  }

  requireClient() {
    if (!this.client || !this.ready) {
      throw new LoxoneError('protocol', 'not connected');
    }
    return this.client;
  }

  /**
   * Closes the socket; the token is killed unless `keepToken` (two requests:
   * when the Miniserver does not answer them, the socket is closed anyway).
   */
  async close({ keepToken = false } = {}) {
    const client = this.client;
    this.ready = false;
    this.client = null;
    if (!client) {
      return;
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve('late'), TIMINGS.closeTimeout);
    });
    const outcome = await Promise.race([client.disconnect(keepToken).catch(() => {}), late]);
    this.timers.clearTimeout(timer);
    if (outcome === 'late') {
      await client.disconnect(true).catch(() => {});
    }
  }
}
