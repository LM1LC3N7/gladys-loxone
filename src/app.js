// -----------------------------------------------------------------------------
// The integration: one Loxone Miniserver, its controls turned into Gladys
// devices, the event tables of its WebSocket feeding the states, and the
// commands sent back. index.js only wires the SDK handlers to it.
//
// Lifecycle: start -> open (probe jdev/cfg/apiKey, token login, structure
// file, devices published, event tables enabled: the Miniserver sends every
// state, then each change) -> on a closed socket, reconnect with a growing
// delay and a fresh client (the structure file and the states are read again).
// The structure is also checked every 10 minutes (jdev/sps/LoxAPPversion3),
// on Scan, and the devices are re-published when a mood list changes.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import LoxoneClient from 'loxone-ts-api';
import { normalizeConfig } from './config.js';
import { LIMITS, TIMINGS } from './constants.js';
import { buildModel, emptyModel, unsupportedTypes } from './devices.js';
import { T } from './i18n.js';
import { Connection, LoxoneError, clientUuidOf, probe, routeLibraryLogs } from './loxone.js';
import { StatePublisher } from './publisher.js';
import { readStructure, uuidKey } from './structure.js';

/** Failures retried slowly: the user has to act, and the Miniserver blocks repeated logins. */
const SLOW = new Set(['auth', 'blocked', 'disabled', 'firmware']);

export class LoxoneApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'loxone' }),
    Client = LoxoneClient,
    fetch = globalThis.fetch,
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.Client = Client;
    this.fetch = fetch;
    this.now = now;
    this.timers = timers;
    routeLibraryLogs(logger);
    this.config = normalizeConfig();
    this.conn = null;
    /** the probe answer: { serial, version, https } */
    this.info = undefined;
    this.inventory = undefined;
    this.model = emptyModel();
    /** state UUID -> last value (number, or string for a text state) */
    this.values = new Map();
    /** the token of the last connection, to log in again without the password */
    this.token = undefined;
    this.online = false;
    /** feature id -> last value read, sent when the user creates the device */
    this.lastValues = new Map();
    /** feature id -> last event value sent (Pushbutton) */
    this.lastEvents = new Map();
    this.created = new Set();
    /** device external id -> the transport entry last published */
    this.transports = new Map();
    this.timer = undefined;
    this.checkTimer = undefined;
    this.republishTimer = undefined;
    this.failures = 0;
    this.generation = 0;
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.warned = new Set();
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    await this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.refreshCreated();
    if (this.config.error) {
      await this.setStatus(false, T.configError(this.config.error));
      return;
    }
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: this.model.throttled,
    });
    this.publisher.start();
    await this.setStatus(false, T.connecting);
    await this.open(generation);
  }

  /** Stops the loops and closes the connection (its token is killed). */
  async stop() {
    this.generation += 1;
    for (const name of ['timer', 'checkTimer', 'republishTimer']) {
      this.timers.clearTimeout(this[name]);
      this[name] = undefined;
    }
    this.publisher.stop();
    this.online = false;
    this.failures = 0;
    const conn = this.conn;
    this.conn = null;
    if (conn) {
      conn.removeAllListeners();
      await conn.close();
      this.token = undefined; // killed
    }
  }

  current(generation) {
    return generation === this.generation;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  /** Runs `fn` after `ms`, unless the app was restarted or stopped meanwhile. */
  schedule(generation, ms, fn) {
    this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      if (this.current(generation)) {
        fn().catch((err) => this.logger.error(`Loxone loop: ${err.message}`));
      }
    }, ms);
  }

  newConnection(config) {
    return new Connection({
      origin: config.origin,
      username: config.username,
      password: config.password,
      // One stable client per Gladys integration: the Miniserver lists its tokens by client.
      clientUuid: clientUuidOf(this.gladys.externalId('client')),
      Client: this.Client,
      logger: this.logger,
      timers: this.timers,
    });
  }

  /** Probes, logs in (the last token first), returns an open connection. */
  async login(config, { token } = {}) {
    const info = await probe(config.origin, { fetch: this.fetch });
    const conn = this.newConnection(config);
    try {
      await conn.open({ token });
    } catch (err) {
      if (!token || err?.kind !== 'auth') {
        throw err;
      }
      // The token expired or was killed: the password then.
      await conn.open();
    }
    return { conn, info };
  }

  /** Connects: probe, login, structure, devices, event tables. */
  async open(generation) {
    let conn;
    try {
      const login = await this.login(this.config, { token: this.token });
      conn = login.conn;
      if (!this.current(generation)) {
        await conn.close();
        return;
      }
      this.conn = conn;
      this.info = login.info;
      this.token = conn.token;
      conn.on('value', (uuid, value) => this.onState(uuid, value));
      conn.on('text', (uuid, text) => this.onState(uuid, text));
      conn.on('closed', (reason) => {
        if (this.current(generation) && this.conn === conn) {
          this.fail(generation, new LoxoneError('unreachable', `connection closed (${reason})`));
        }
      });
      await this.loadStructure(generation);
      if (!this.current(generation)) {
        return;
      }
      await conn.enableUpdates();
      this.online = true;
      this.failures = 0;
      this.logger.info(
        `Connected to the Miniserver ${this.inventory.ms.name || this.info.serial} ${this.info.version} at ${this.config.origin}`,
      );
      await this.setStatus(
        true,
        T.connected(this.inventory.ms, this.info, this.model.devices.length),
      );
      await this.publishAllTransports();
      this.scheduleCheck(generation, TIMINGS.structureCheck);
    } catch (err) {
      await this.fail(generation, err, conn);
    }
  }

  async fail(generation, err, conn = this.conn) {
    if (conn?.failed) {
      return; // closed while it was opening: already handled
    }
    if (conn) {
      conn.failed = true;
      conn.removeAllListeners();
      if (conn === this.conn) {
        this.conn = null;
      }
      await conn.close({ keepToken: true });
    }
    if (!this.current(generation)) {
      return;
    }
    this.online = false;
    this.failures += 1;
    if (err?.kind === 'auth') {
      this.token = undefined;
    }
    const delay = SLOW.has(err?.kind)
      ? TIMINGS.authRetry
      : Math.min(TIMINGS.retryMax, TIMINGS.retryMin * 2 ** (this.failures - 1));
    if (err instanceof LoxoneError) {
      this.logger.warn(`Loxone: ${err.message} (retrying in ${Math.round(delay / 1000)} s)`);
    } else {
      this.logger.error('Loxone: unexpected failure', err);
    }
    await this.setStatus(false, T.failure(err));
    await this.publishAllTransports();
    this.timers.clearTimeout(this.checkTimer);
    this.schedule(generation, delay, () => this.open(generation));
  }

  // --- States ------------------------------------------------------------------

  /** A value or text event: the features reading this state are read again. */
  onState(uuid, value) {
    const key = uuidKey(uuid);
    if (!key || value === undefined || value === null) {
      return;
    }
    const previous = this.values.get(key);
    this.values.set(key, value);
    for (const reader of this.model.readers.get(key) ?? []) {
      this.evaluate(reader);
    }
    if (this.model.healthDeps.has(key)) {
      this.publishTransports(this.model.healthDeps.get(key)).catch((err) =>
        this.logger.warn(`Transport badge failed: ${err.message}`),
      );
    }
    if (this.model.watch.has(key) && previous !== value) {
      this.scheduleRepublish(this.generation);
    }
  }

  evaluate({ featureId, read, event }) {
    let value;
    try {
      value = read((uuid) => this.values.get(uuid));
    } catch (err) {
      this.warnOnce(`read:${featureId}`, `${featureId}: ${err.message}`);
      return;
    }
    if (value === undefined) {
      return;
    }
    if (event) {
      // Every change, in order (a press is 1 then 0): no merge, no repeat.
      this.lastValues.set(featureId, value);
      if (this.created.has(featureId) && this.lastEvents.get(featureId) !== value) {
        this.lastEvents.set(featureId, value);
        this.publisher.pushEvent(featureId, value);
      }
      return;
    }
    this.record(featureId, value);
  }

  /** Reads every feature from the values known (after a new model). */
  readAll() {
    const seen = new Set();
    for (const readers of this.model.readers.values()) {
      for (const reader of readers) {
        if (!seen.has(reader)) {
          seen.add(reader);
          this.evaluate(reader);
        }
      }
    }
  }

  /** Keeps the value, and sends it when the device exists in Gladys. */
  record(featureId, value) {
    this.lastValues.set(featureId, value);
    if (this.created.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  // --- Structure -----------------------------------------------------------------

  idsOf(platformId) {
    return this.gladys.externalIds('loxone', platformId);
  }

  /** Reads the structure file and publishes the devices. */
  async loadStructure(generation, { force = false } = {}) {
    const raw = await this.conn.structure();
    if (!this.current(generation)) {
      return;
    }
    this.inventory = readStructure(raw);
    await this.rebuild({ force });
  }

  /** The model from the inventory and the values known; the devices published when changed. */
  async rebuild({ force = false } = {}) {
    const inventory = this.inventory;
    const model = buildModel((id) => this.idsOf(id), inventory, {
      unit: inventory.ms.unit,
      get: (uuid) => this.values.get(uuid),
    });
    this.model = model;
    this.publisher.configure({
      intervalSeconds: this.config.sensorInterval,
      throttled: model.throttled,
    });
    this.readAll();
    const json = JSON.stringify(model.devices);
    if (force || json !== this.publishedDevices) {
      try {
        await this.gladys.publishDiscoveredDevices(model.devices);
        this.publishedDevices = json;
        const unsupported = unsupportedTypes(model);
        this.logger.info(
          `${model.devices.length} devices offered in Discovery (${model.counts.controls} Loxone blocks` +
            (unsupported.length > 0
              ? `; not supported yet: ${unsupported
                  .slice(0, LIMITS.typesListed)
                  .map(([type, n]) => `${type} ×${n}`)
                  .join(', ')})`
              : ')'),
        );
      } catch (err) {
        this.logger.error(`Publishing the discovered devices failed: ${err.message}`);
      }
    }
  }

  /** Asks the Miniserver whether its structure changed, then again later. */
  scheduleCheck(generation, ms) {
    this.timers.clearTimeout(this.checkTimer);
    this.checkTimer = this.timers.setTimeout(() => {
      this.checkTimer = undefined;
      if (!this.current(generation) || !this.online) {
        return; // the reconnection reads it anyway
      }
      this.checkStructure(generation)
        .catch((err) => this.logger.warn(`Checking the Loxone structure failed: ${err.message}`))
        .finally(() => {
          if (this.current(generation) && this.online && !this.checkTimer) {
            this.scheduleCheck(generation, TIMINGS.structureCheck);
          }
        });
    }, ms);
  }

  async checkStructure(generation) {
    const version = await this.conn.structureVersion();
    if (!this.current(generation) || !version || version === this.inventory?.lastModified) {
      return;
    }
    this.logger.info(`The Loxone configuration changed (${version}): reading it again`);
    await this.loadStructure(generation);
    if (this.current(generation) && this.online) {
      await this.setStatus(
        true,
        T.connected(this.inventory.ms, this.info, this.model.devices.length),
      );
      await this.publishAllTransports();
    }
  }

  /** A mood list changed: the select options are published again, once the burst ends. */
  scheduleRepublish(generation) {
    this.timers.clearTimeout(this.republishTimer);
    this.republishTimer = this.timers.setTimeout(() => {
      this.republishTimer = undefined;
      if (this.current(generation) && this.inventory) {
        this.rebuild().catch((err) => this.logger.warn(`Re-publishing failed: ${err.message}`));
      }
    }, TIMINGS.republishDebounce);
  }

  /** The Scan button of the Discovery tab. */
  async rescan() {
    if (!this.online || !this.conn) {
      await this.gladys.publishDiscoveredDevices(this.model.devices);
      return;
    }
    await this.loadStructure(this.generation, { force: true });
  }

  // --- Transport badges ----------------------------------------------------------

  /** The badge of a device: unreachable with the Miniserver, degraded when its Loxone device is offline. */
  transportOf(deviceId) {
    if (!this.online) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    const health = this.model.health.get(deviceId);
    let offline;
    try {
      offline = health ? health.read((uuid) => this.values.get(uuid)) === true : false;
    } catch {
      offline = false;
    }
    return offline
      ? { transport: DEVICE_TRANSPORTS.LOCAL, degraded: true, message: T.offline }
      : { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  /** The entries of the devices whose badge changed (only those created in Gladys). */
  changedTransports(deviceIds) {
    const created = this.createdDevices();
    const entries = [];
    for (const deviceId of deviceIds) {
      if (!created.has(deviceId)) {
        continue;
      }
      const entry = this.transportOf(deviceId);
      const key = JSON.stringify(entry);
      if (this.transports.get(deviceId) !== key) {
        this.transports.set(deviceId, key);
        entries.push({ external_id: deviceId, ...entry });
      }
    }
    return entries;
  }

  async publishTransports(deviceIds) {
    const entries = this.changedTransports(deviceIds);
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys.publishTransports(entries.slice(i, i + 100));
    }
  }

  async publishAllTransports() {
    await this.publishTransports([...this.createdDevices()]).catch((err) =>
      this.logger.warn(`Transport badges failed: ${err.message}`),
    );
  }

  // --- Devices created by the user -------------------------------------------------

  createdDevices() {
    const ours = new Set(this.model.deviceIds);
    return new Set(
      (this.gladys.devices ?? []).map((d) => d.external_id).filter((id) => ours.has(id)),
    );
  }

  refreshCreated() {
    this.created = new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    for (const f of device?.features ?? []) {
      this.lastEvents.delete(f.external_id);
      const value = this.lastValues.get(f.external_id);
      if (value !== undefined) {
        this.publisher.push(f.external_id, value);
      }
    }
    if (device?.external_id) {
      await this.publishTransports([device.external_id]).catch(() => {});
    }
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  // --- Commands ------------------------------------------------------------------

  async setValue(device, feature, value) {
    const conn = this.conn;
    if (!conn || !this.online) {
      throw new Error(T.notConnected.en);
    }
    const writer = this.model.writers.get(feature.external_id);
    if (!writer) {
      throw new Error(`${feature.name ?? feature.external_id} cannot be controlled`);
    }
    const calls = writer.write(value, (uuid) => this.values.get(uuid));
    for (const { uuid, command } of calls) {
      await conn.command(uuid, command);
    }
    this.logger.debug(`${calls.map((c) => c.command).join(', ')} sent to ${writer.name}`);
    if (this.model.optimistic.has(feature.external_id)) {
      this.record(feature.external_id, Number(value));
    }
  }

  // --- Configuration screen button ---------------------------------------------------

  /** Logs in with the saved configuration, reads the structure, counts, logs out. */
  async testConnection() {
    const config = this.config;
    if (config.error) {
      return T.configError(config.error);
    }
    let conn;
    try {
      const login = await this.login(config);
      conn = login.conn;
      const inventory = readStructure(await conn.structure());
      const model = buildModel((id) => this.idsOf(id), inventory, { unit: inventory.ms.unit });
      return T.test.ok({
        ms: inventory.ms,
        info: login.info,
        devices: model.devices.length,
        controls: model.counts.controls,
        unsupported: unsupportedTypes(model).slice(0, LIMITS.typesListed),
        empty: model.counts.empty,
        hidden: inventory.skipped.hidden,
      });
    } catch (err) {
      if (!(err instanceof LoxoneError)) {
        this.logger.error('Loxone test failed', err);
      }
      return T.failure(err);
    } finally {
      await conn?.close();
    }
  }
}
