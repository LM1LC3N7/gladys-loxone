// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake Miniserver standing for loxone-ts-api (its LoxoneClient
// surface and the apiKey request). Timers are mocked: the reconnections, the
// structure checks and the state flush run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { LoxoneApp } from '../src/app.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { T } from '../src/i18n.js';
import {
  COVER_STATE,
  OPENING_SENSOR_STATE,
  THERMOSTAT_MODE,
  THERMOSTAT_PRESET,
} from '../src/mapping.js';
import { C, MOODS, PASSWORD, SUB, USER, structure } from './fixtures/loxone.js';
import { fakeMiniserver, settle } from './helpers/fakeLoxone.js';

const CONFIG = { host: '192.168.1.77', username: USER, password: PASSWORD };
const FLUSH = TIMINGS.flushInterval;

async function setup(t, { config = CONFIG, ms = fakeMiniserver() } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_760_000_000_000 });
  const gladys = createFakeGladys({ config });
  const app = new LoxoneApp({
    gladys,
    Client: ms.Client,
    fetch: ms.fetch,
    now: () => Date.now(),
    logger: createLogger({ level: 'silent' }),
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  return { gladys, app, ms, tick };
}

const deviceNamed = (gladys, name) => gladys.fake.discoveredDevices.find((d) => d.name === name);

async function created(gladys, name) {
  const device = deviceNamed(gladys, name);
  assert.ok(device, `${name} is discovered`);
  await gladys.fake.deviceCreated(device);
  return device;
}

const featureOf = (device, key) => {
  const feature = device.features.find((f) => f.external_id === `${device.external_id}:${key}`);
  assert.ok(feature, `${device.name} has ${key}`);
  return feature;
};

const last = (gladys, device, key) => gladys.fake.lastState(`${device.external_id}:${key}`);

test('the blocks become Gladys devices, the values flow once created', async (t) => {
  const { gladys, ms, tick } = await setup(t);
  assert.equal(ms.last().address, 'http://192.168.1.77');
  assert.equal(ms.last().options.autoReconnectEnabled, false, 'the app reconnects itself');
  assert.match(ms.last().options.clientUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{16}$/);
  const names = gladys.fake.discoveredDevices.map((d) => d.name);
  assert.equal(names.length, 30);
  for (const name of [
    'Prise TV (Salon)',
    'Éclairage salon (Salon)',
    'Spots (Salon)',
    'Ruban LED (Salon)',
    'Lampadaire (Salon)',
    'Volet salon (Salon)',
    'Tous les volets',
    'Chauffage salon (Salon)',
    'Compteur réseau (Garage)',
    'Coffre (Bureau)',
  ]) {
    assert.ok(names.includes(name), `${name} is offered`);
  }
  for (const name of ['Relais interne (Garage)', 'Musique salon (Salon)', 'Batterie (Garage)']) {
    assert.ok(!names.includes(name), `${name} is not offered`);
  }
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(
    gladys.fake.connectionStatus.message.en,
    'Connected to the Miniserver "Maison" (firmware 15.2.10.14): 30 devices in Discovery.',
  );

  await tick(FLUSH);
  assert.equal(gladys.fake.states.length, 0, 'nothing is sent for a device not created');

  const plug = await created(gladys, 'Prise TV (Salon)');
  const heating = await created(gladys, 'Chauffage salon (Salon)');
  const grid = await created(gladys, 'Compteur réseau (Garage)');
  await tick(FLUSH);
  assert.equal(last(gladys, plug, 'binary'), 1);
  assert.equal(last(gladys, heating, 'temperature'), 20.8);
  assert.equal(last(gladys, heating, 'setpoint'), 21);
  assert.equal(last(gladys, heating, 'mode'), THERMOSTAT_MODE.HEATING);
  assert.equal(last(gladys, heating, 'preset'), THERMOSTAT_PRESET.COMFORT);
  assert.equal(last(gladys, grid, 'power'), -0.85);
  assert.equal(last(gladys, grid, 'energy'), 10234.5);
  assert.equal(last(gladys, grid, 'energy-export'), 3120.2);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: grid.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('the event tables reach Gladys: changes only, measurements throttled', async (t) => {
  const { gladys, ms, tick } = await setup(t);
  const lamp = await created(gladys, "Lampe d'appoint (Salon)");
  const shutter = await created(gladys, 'Volet salon (Salon)');
  const house = await created(gladys, 'Consommation maison (Garage)');
  const window = await created(gladys, 'Fenêtre cuisine (Salon)');
  const pump = await created(gladys, 'Statut pompe (Garage)');
  await tick(FLUSH);
  assert.equal(last(gladys, shutter, 'position'), 75, 'Loxone 0.25 down is 75 % open');
  assert.equal(last(gladys, house, 'power'), 1.234);
  assert.equal(last(gladys, pump, 'text'), 'Marche');
  const sent = gladys.fake.states.length;

  ms.set(C.lamp.states.active, 1);
  ms.set(C.shutter.states.down, 1);
  ms.set(C.shutter.states.position, 0.5);
  ms.set(C.kitchenWindow.states.active, 1);
  ms.set(C.house.states.actual, 2.5);
  ms.set(C.pump.states.text, '');
  await tick(FLUSH);
  assert.equal(last(gladys, lamp, 'binary'), 1);
  assert.equal(last(gladys, shutter, 'state'), COVER_STATE.CLOSE, 'moving down');
  assert.equal(last(gladys, shutter, 'position'), 50);
  assert.equal(last(gladys, window, 'opening'), OPENING_SENSOR_STATE.OPEN);
  assert.equal(last(gladys, pump, 'text'), '—', 'an empty text is shown as a dash');
  assert.equal(last(gladys, house, 'power'), 1.234, 'a measurement waits for the sensor interval');
  await tick(10_000);
  assert.equal(last(gladys, house, 'power'), 2.5);

  // The same value again is not sent again.
  const before = gladys.fake.states.length;
  ms.set(C.lamp.states.active, 1);
  await tick(FLUSH);
  assert.equal(gladys.fake.states.length, before);
  assert.ok(before > sent);
});

test('the Gladys commands become Loxone commands', async (t) => {
  const { gladys, ms } = await setup(t);
  const run = async (name, key, value) => {
    const device = deviceNamed(gladys, name);
    const from = ms.commands.length;
    const ack = await gladys.fake.setValue(device, featureOf(device, key), value);
    assert.equal(ack.success, true, `${name} ${key}=${value}: ${ack.error}`);
    return ms.commands.slice(from);
  };
  assert.deepEqual(await run('Prise TV (Salon)', 'binary', 0), [[C.plug.uuid, 'off']]);
  assert.deepEqual(await run('Lumière escalier (Entrée)', 'binary', 1), [[C.stairs.uuid, 'on']]);
  assert.deepEqual(await run('Sonnette (Entrée)', 'binary', 1), [[C.bell.uuid, 'pulse']]);
  assert.deepEqual(await run('Applique (Chambre)', 'brightness', 55.4), [[C.sconce.uuid, '55']]);
  assert.deepEqual(await run('Volet salon (Salon)', 'position', 30), [
    [C.shutter.uuid, 'manualPosition/70'],
  ]);
  assert.deepEqual(await run('Volet salon (Salon)', 'position', 100), [[C.shutter.uuid, 'FullUp']]);
  assert.deepEqual(await run('Volet salon (Salon)', 'state', COVER_STATE.STOP), [
    [C.shutter.uuid, 'stop'],
  ]);
  assert.deepEqual(await run('Tous les volets', 'state', COVER_STATE.CLOSE), [
    [C.allShutters.uuid, 'FullDown'],
  ]);
  assert.deepEqual(await run('Portail (Extérieur)', 'state', COVER_STATE.OPEN), [
    [C.gate.uuid, 'open'],
  ]);
  assert.deepEqual(await run('Velux bureau (Bureau)', 'position', 40), [
    [C.velux.uuid, 'moveToPosition/40'],
  ]);
  assert.deepEqual(await run('Chauffage salon (Salon)', 'setpoint', 21.5), [
    [C.heating.uuid, 'override/3//21.5'],
  ]);
  assert.deepEqual(await run('Chauffage salon (Salon)', 'mode', THERMOSTAT_MODE.AUTO), [
    [C.heating.uuid, 'setOperatingMode/0'],
  ]);
  assert.deepEqual(await run('Chauffage salon (Salon)', 'preset', THERMOSTAT_PRESET.ECO), [
    [C.heating.uuid, 'override/0'],
  ]);
  assert.deepEqual(await run('Chauffage salon (Salon)', 'preset', THERMOSTAT_PRESET.SCHEDULE), [
    [C.heating.uuid, 'stopOverride'],
  ]);
  assert.deepEqual(await run('Éclairage salon (Salon)', 'mood', '2'), [
    [C.lights.uuid, 'changeTo/2'],
  ]);
  assert.deepEqual(await run('Éclairage salon (Salon)', 'binary', 0), [
    [C.lights.uuid, 'changeTo/778'],
  ]);
  assert.deepEqual(await run('Éclairage salon (Salon)', 'binary', 1), [
    [C.lights.uuid, 'changeTo/777'],
  ]);
  assert.deepEqual(await run('Éclairage salon (Salon)', 'brightness', 30), [
    [SUB.master.uuid, '30'],
  ]);
  assert.deepEqual(await run('Spots (Salon)', 'binary', 1), [[SUB.spots.uuid, 'on']]);
  assert.deepEqual(await run('Ruban LED (Salon)', 'color', 0xff0000), [
    [SUB.ledStrip.uuid, 'hsv(0,100,50)'],
  ]);
  assert.deepEqual(await run('Ruban LED (Salon)', 'brightness', 100), [
    [SUB.ledStrip.uuid, 'hsv(240,100,100)'],
  ]);
});

test('a refused command, a secured block and a read-only feature fail with a reason', async (t) => {
  const { gladys, ms } = await setup(t);
  ms.answer = (uuid) => (uuid === C.plug.uuid ? { code: 403, value: '' } : undefined);
  const plug = deviceNamed(gladys, 'Prise TV (Salon)');
  const ack = await gladys.fake.setValue(plug, featureOf(plug, 'binary'), 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /may not control this block/);

  const safe = deviceNamed(gladys, 'Coffre (Bureau)');
  assert.equal(
    featureOf(safe, 'binary').read_only,
    true,
    'a secured block needs the visu password',
  );
  const refused = await gladys.fake.setValue(safe, featureOf(safe, 'binary'), 1);
  assert.equal(refused.success, false);
  assert.match(refused.error, /cannot be controlled/);

  const outside = deviceNamed(gladys, 'Température extérieure (Extérieur)');
  assert.equal(featureOf(outside, 'temperature').read_only, true);
});

test('a push button press is 1 then 0: both reach Gladys, in order', async (t) => {
  const { gladys, ms, tick } = await setup(t);
  const bell = await created(gladys, 'Sonnette (Entrée)');
  await tick(FLUSH);
  const id = `${bell.external_id}:binary`;
  const start = gladys.fake.states.filter((s) => s.device_feature_external_id === id).length;
  ms.set(C.bell.states.active, 1);
  ms.set(C.bell.states.active, 0);
  ms.set(C.bell.states.active, 1);
  ms.set(C.bell.states.active, 0);
  await tick(FLUSH);
  const values = gladys.fake.states
    .filter((s) => s.device_feature_external_id === id)
    .slice(start)
    .map((s) => s.state);
  assert.deepEqual(values, [1, 0, 1, 0]);
});

test('the moods of a lighting controller are a select, re-published when the list changes', async (t) => {
  const { gladys, ms, tick } = await setup(t);
  // The mood list arrives with the event tables: the devices are published again.
  await tick(TIMINGS.republishDebounce);
  const options = () =>
    featureOf(deviceNamed(gladys, 'Éclairage salon (Salon)'), 'mood').supported_options;
  assert.deepEqual(options(), [
    { value: '778', label: 'Tout éteint' },
    { value: '1', label: 'Lecture' },
    { value: '2', label: 'Soirée' },
    { value: '777', label: 'Tout allumé' },
  ]);
  const lights = await created(gladys, 'Éclairage salon (Salon)');
  await tick(FLUSH);
  assert.equal(last(gladys, lights, 'mood'), '1');
  assert.equal(last(gladys, lights, 'binary'), 1);
  assert.equal(last(gladys, lights, 'brightness'), 80);

  ms.set(C.lights.states.activeMoods, '[778]');
  await tick(FLUSH);
  assert.equal(last(gladys, lights, 'mood'), '778');
  assert.equal(last(gladys, lights, 'binary'), 0);

  const list = JSON.parse(MOODS);
  list.push({ name: 'Cinéma', id: 3 });
  ms.set(C.lights.states.moodList, JSON.stringify(list));
  await tick(TIMINGS.republishDebounce);
  assert.ok(options().some((o) => o.value === '3' && o.label === 'Cinéma'));
});

test('a lost connection: unreachable badges, reconnection with the token, then the password', async (t) => {
  const { gladys, app, ms, tick } = await setup(t);
  const plug = await created(gladys, 'Prise TV (Salon)');
  await tick(FLUSH);
  assert.equal(ms.issued, 1);
  const token = app.token;
  ms.drop();
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /unreachable: connection closed/);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: plug.external_id,
    transport: DEVICE_TRANSPORTS.UNREACHABLE,
  });

  // A value changed meanwhile comes with the event tables of the reconnection.
  ms.values.set(C.plug.states.active, 0);
  await tick(TIMINGS.retryMin);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(ms.issued, 1, 'the token logs in again, no new token');
  assert.equal(ms.last().auth.tokenHandler.token, token);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.LOCAL);
  await tick(FLUSH);
  assert.equal(last(gladys, plug, 'binary'), 0);

  // The token was killed on the Miniserver: the password, at once.
  ms.tokens.clear();
  ms.drop();
  await settle();
  await tick(TIMINGS.retryMin);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(ms.issued, 2);
});

test('refused credentials are retried slowly, a blocked address too', async (t) => {
  const { gladys, ms, tick } = await setup(t, { config: { ...CONFIG, password: 'wrong' } });
  assert.deepEqual(gladys.fake.connectionStatus.message, T.failure({ kind: 'auth' }));
  const attempts = ms.clients.length;
  assert.equal(ms.last().state, 'disconnected', 'the failed socket is closed');
  await tick(TIMINGS.retryMax);
  assert.equal(ms.clients.length, attempts, 'no retry within a minute');
  await tick(TIMINGS.authRetry);
  assert.equal(ms.clients.length, attempts + 1);

  ms.refuseWith = 'Failing pending request because Closed with code 4003, reason: ';
  await tick(TIMINGS.authRetry);
  assert.deepEqual(gladys.fake.connectionStatus.message, T.failure({ kind: 'blocked' }));
});

test('an unreachable Miniserver: a precise status, retries, then connected', async (t) => {
  const ms = fakeMiniserver();
  ms.network = 'down';
  const { gladys, tick } = await setup(t, { ms });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /ECONNREFUSED on http:\/\/192\.168\.1\.77/);
  assert.equal(ms.clients.length, 0, 'the library is not started for an unreachable address');
  ms.network = 'rebooting';
  await tick(TIMINGS.retryMin);
  assert.deepEqual(gladys.fake.connectionStatus.message, T.failure({ kind: 'rebooting' }));
  ms.network = 'up';
  await tick(TIMINGS.retryMin * 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('an old firmware is refused before the library sees it', async (t) => {
  const ms = fakeMiniserver({ version: '10.3.11.27' });
  const { gladys } = await setup(t, { ms });
  assert.match(gladys.fake.connectionStatus.message.en, /too old \(firmware 10\.3\.11\.27\)/);
  assert.equal(ms.clients.length, 0);
});

test('a structure changed in Loxone Config is read again', async (t) => {
  const { gladys, ms, tick } = await setup(t);
  const count = gladys.fake.discoveredDevices.length;
  await tick(TIMINGS.structureCheck);
  assert.equal(gladys.fake.discoveredDevices.length, count, 'same lastModified: nothing re-read');

  const added = {
    uuid: '1a2bffff-03c4-2f17-ffff504f94afffff',
    states: { active: '1a2bfffe-03c4-2f17-ffff504f94affffe' },
  };
  ms.structure = structure({ lastModified: '2026-10-16 09:00:00' });
  ms.structure.controls[added.uuid] = {
    name: 'Prise jardin',
    type: 'Switch',
    uuidAction: added.uuid,
    states: added.states,
  };
  await tick(TIMINGS.structureCheck);
  assert.equal(gladys.fake.discoveredDevices.length, count + 1);
  assert.ok(deviceNamed(gladys, 'Prise jardin'));
  assert.equal(gladys.fake.connectionStatus.message.en.includes(`${count + 1} devices`), true);
});

test('a Loxone device offline gives a degraded badge', async (t) => {
  const { gladys, ms, tick } = await setup(t);
  const shutter = await created(gladys, 'Volet salon (Salon)');
  ms.set(C.shutter.states.deviceState, 1);
  await settle();
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: shutter.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
    degraded: true,
    message: T.offline,
  });
  ms.set(C.shutter.states.deviceState, 2);
  await tick(0);
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: shutter.external_id,
    transport: DEVICE_TRANSPORTS.LOCAL,
  });
});

test('a message the library cannot decode closes the connection, the app reconnects', async (t) => {
  const { gladys, ms, tick } = await setup(t);
  const client = ms.last();
  // The fake's handler throws like the library's, the guard installed by the app catches it.
  assert.doesNotThrow(() => client.webSocketConnection.handleMessage('garbage', false));
  await settle();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  await tick(TIMINGS.retryMin);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.notEqual(ms.last(), client, 'a fresh client');
});

test('test_connection logs in, counts and logs out', async (t) => {
  const { gladys, ms } = await setup(t);
  const tokens = ms.issued;
  const ack = await gladys.fake.action(ACTIONS.TEST, {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.en,
    'Connection OK, Miniserver "Maison" Gen 1 (firmware 15.2.10.14, project "Maison Dupont"): ' +
      '31 blocks, 30 devices offered in Discovery. Not supported yet: Alarm ×1, AudioZoneV2 ×1, Daytimer ×1. ' +
      '2 left out (nothing to offer or hidden).',
  );
  assert.equal(ms.issued, tokens + 1);
  assert.ok(ms.killed.includes(`jwt-${tokens + 1}`), 'its token is killed');
  assert.equal(gladys.fake.connectionStatus.connected, true, 'the live connection stays');

  ms.users[USER] = 'changed';
  const refused = await gladys.fake.action(ACTIONS.TEST, {});
  assert.deepEqual(refused.data.message, T.failure({ kind: 'auth' }));
});

test('Scan reads the structure again, stop kills the token', async (t) => {
  const { gladys, app, ms } = await setup(t);
  gladys.fake.discoveredDevices.length = 0;
  await gladys.fake.scanRequest();
  assert.equal(gladys.fake.discoveredDevices.length, 30);
  const token = app.token;
  await app.stop();
  assert.ok(ms.killed.includes(token));
});

test('the configuration errors are shown, nothing is started', async (t) => {
  const ms = fakeMiniserver();
  const { gladys, app } = await setup(t, { ms, config: {} });
  assert.deepEqual(gladys.fake.connectionStatus.message, T.notConfigured);
  await app.start({ ...CONFIG, host: '50:4F:94:A0:B1:C2' });
  assert.deepEqual(gladys.fake.connectionStatus.message, T.badAddress('serial'));
  await app.start({ ...CONFIG, host: 'http://admin:pw@192.168.1.77' });
  assert.deepEqual(gladys.fake.connectionStatus.message, T.badAddress('credentials'));
  assert.equal(ms.probes.length, 0);
});
