import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  COVER_STATE,
  OPENING_SENSOR_STATE,
  THERMOSTAT_MODE,
  THERMOSTAT_PRESET,
  digitalKind,
  mapControl,
  measurementOf,
  moodsOf,
} from '../src/mapping.js';
import { readStructure } from '../src/structure.js';
import { C, SUB, initialValues, structure } from './fixtures/loxone.js';

const inventory = readStructure(structure());
const controlOf = (c) => inventory.controls.find((x) => x.uuid === c.uuid);

function mapped(c, { values = initialValues(), unit = 'C', index = 0 } = {}) {
  const get = (uuid) => values.get(uuid);
  const entry = mapControl(controlOf(c), { unit, get })[index];
  assert.ok(entry, `${c.section.name} maps`);
  const feature = (key) => {
    const f = entry.features.find((x) => x.key === key);
    assert.ok(f, `${c.section.name} has ${key}`);
    return f;
  };
  const read = (key) => entry.readers.find((r) => r.key === key)?.read(get);
  const write = (key, value) => entry.writers[key](value, get).map((x) => x.command);
  return { entry, feature, read, write, values, get };
}

test('Switch: a switch, or a light in a "lights" category', () => {
  const plug = mapped(C.plug);
  assert.deepEqual(
    [plug.feature('binary').category, plug.feature('binary').type],
    [CAT.SWITCH, T.SWITCH.BINARY],
  );
  assert.equal(plug.read('binary'), 1);
  assert.deepEqual(plug.write('binary', 0), ['off']);
  assert.deepEqual(plug.write('binary', 1), ['on']);
  assert.equal(mapped(C.lamp).feature('binary').category, CAT.LIGHT);
});

test('TimedSwitch and Pushbutton', () => {
  const stairs = mapped(C.stairs);
  stairs.values.set(C.stairs.states.deactivationDelay, -1);
  assert.equal(stairs.read('binary'), 1, '-1: on for good');
  stairs.values.set(C.stairs.states.deactivationDelay, 42);
  assert.equal(stairs.read('binary'), 1, 'counting down');
  stairs.values.set(C.stairs.states.deactivationDelay, 0);
  assert.equal(stairs.read('binary'), 0);
  const bell = mapped(C.bell);
  assert.equal(bell.entry.readers[0].event, true, 'every press is sent');
  assert.deepEqual(bell.write('binary', 1), ['pulse']);
  assert.deepEqual(bell.write('binary', 0), ['off']);
});

test('Dimmer and EIBDimmer: on/off and brightness from the position', () => {
  const sconce = mapped(C.sconce);
  assert.equal(sconce.read('binary'), 1);
  assert.equal(sconce.read('brightness'), 40);
  assert.equal(sconce.feature('brightness').unit, U.PERCENT);
  assert.deepEqual(sconce.write('brightness', 140), ['100']);
  assert.deepEqual(sconce.write('binary', 0), ['off']);
  const knx = mapped(C.knx);
  assert.equal(knx.read('binary'), 0);
  assert.equal(knx.feature('binary').category, CAT.LIGHT);
});

test('LightControllerV2: moods as a select, on/off, master brightness, one device per circuit', () => {
  const values = initialValues();
  const get = (uuid) => values.get(uuid);
  const entries = mapControl(controlOf(C.lights), { get });
  assert.deepEqual(
    entries.map((e) => e.name),
    ['Éclairage salon', 'Spots', 'Ruban LED', 'Lampadaire'],
    'the masters are features of the controller, not devices',
  );
  const lights = mapped(C.lights, { values });
  const mood = lights.feature('mood');
  assert.deepEqual([mood.category, mood.type], [CAT.TEXT, T.TEXT.SELECT]);
  assert.deepEqual(
    mood.supported_options.map((o) => o.value),
    ['778', '1', '2', '777'],
  );
  assert.equal(lights.read('mood'), '1');
  assert.equal(lights.read('brightness'), 80);
  assert.deepEqual(lights.write('mood', '2'), ['changeTo/2']);
  assert.throws(() => lights.write('mood', 'Lecture'), /not a mood/);
  assert.deepEqual(lights.entry.watch, [C.lights.states.moodList]);
  values.set(C.lights.states.activeMoods, '[778]');
  assert.equal(lights.read('binary'), 0);
  values.set(C.lights.states.activeMoods, '[1,2]');
  assert.equal(lights.read('binary'), 1);
  assert.equal(lights.read('mood'), '1', 'mixed moods: the first one');
  // Without "all on" in the list: the first favorite mood.
  values.set(C.lights.states.moodList, JSON.stringify([{ id: 4, name: 'A' }]));
  values.set(C.lights.states.favoriteMoods, '[778,2]');
  assert.deepEqual(lights.write('binary', 1), ['changeTo/2']);
  // Before the mood list arrives, only "off" is offered.
  const early = mapControl(controlOf(C.lights))[0];
  assert.deepEqual(early.features.find((f) => f.key === 'mood').supported_options, [
    { value: '778', label: 'Off' },
  ]);
});

test('light circuits: a switch, a dimmer, a color picker', () => {
  const floor = mapped(C.lights, { index: 3 });
  assert.equal(floor.entry.uuid, SUB.floorLamp.uuid.toLowerCase());
  assert.equal(floor.feature('binary').category, CAT.LIGHT);
  assert.equal(floor.read('binary'), 1);
  const strip = mapped(C.lights, { index: 2 });
  assert.equal(strip.read('binary'), 1);
  assert.equal(strip.read('brightness'), 50);
  assert.equal(strip.read('color'), 0x0000ff);
  assert.deepEqual(strip.write('color', 0x00ff00), ['hsv(120,100,50)']);
  assert.deepEqual(strip.write('binary', 0), ['hsv(240,100,0)']);
  strip.values.set(SUB.ledStrip.states.color, 'temp(70,2700)');
  assert.equal(strip.read('brightness'), 70);
  assert.equal(strip.read('color'), undefined, 'white: the last color stays');
  assert.deepEqual(strip.write('brightness', 20), ['temp(20,2700)']);
  strip.values.delete(SUB.ledStrip.states.color);
  assert.deepEqual(strip.write('binary', 1), ['hsv(0,0,100)'], 'unknown: white');
});

test('Jalousie: position (Gladys 100 = open), motion, curtains, offline motor', () => {
  const shutter = mapped(C.shutter);
  const position = shutter.feature('position');
  assert.deepEqual([position.category, position.type], [CAT.SHUTTER, T.SHUTTER.POSITION]);
  assert.equal(shutter.read('position'), 75);
  assert.equal(shutter.read('state'), COVER_STATE.STOP);
  shutter.values.set(C.shutter.states.up, 1);
  assert.equal(shutter.read('state'), COVER_STATE.OPEN);
  assert.deepEqual(shutter.write('position', 30), ['manualPosition/70']);
  assert.deepEqual(shutter.write('position', 0), ['FullDown']);
  assert.deepEqual(shutter.write('state', COVER_STATE.OPEN), ['FullUp']);
  assert.throws(() => shutter.write('state', 5), /cannot do 5/);
  assert.equal(shutter.entry.health.read(shutter.get), false);
  shutter.values.set(C.shutter.states.deviceState, 1);
  assert.equal(shutter.entry.health.read(shutter.get), true);
  const curtain = mapped(C.curtain);
  assert.equal(curtain.feature('position').category, CAT.CURTAIN);
  assert.equal(curtain.read('position'), 0);
});

test('central objects, gate and window', () => {
  const all = mapped(C.allShutters);
  assert.deepEqual(
    all.entry.features.map((f) => f.key),
    ['state'],
  );
  assert.deepEqual(all.entry.optimistic, ['state']);
  assert.deepEqual(all.write('state', COVER_STATE.CLOSE), ['FullDown']);
  assert.deepEqual(mapped(C.allGates).write('state', COVER_STATE.STOP), ['stop']);
  const gate = mapped(C.gate);
  assert.equal(gate.feature('position').read_only, true, 'a gate opens or closes');
  gate.values.set(C.gate.states.active, -1);
  assert.equal(gate.read('state'), COVER_STATE.CLOSE);
  assert.deepEqual(gate.write('state', COVER_STATE.OPEN), ['open']);
  const velux = mapped(C.velux);
  assert.equal(velux.read('position'), 30);
  assert.deepEqual(velux.write('position', 100), ['fullopen']);
  assert.deepEqual(velux.write('position', 0), ['fullclose']);
  assert.deepEqual(velux.write('state', COVER_STATE.CLOSE), ['fullclose']);
});

test('IRoomControllerV2: temperature, setpoint, mode, preset', () => {
  const heating = mapped(C.heating);
  assert.equal(heating.read('temperature'), 20.8);
  assert.equal(heating.feature('temperature').unit, U.CELSIUS);
  const setpoint = heating.feature('setpoint');
  assert.deepEqual([setpoint.min, setpoint.max, setpoint.step], [5, 35, 0.5]);
  assert.deepEqual(heating.write('setpoint', 40), ['override/3//35']);
  assert.equal(heating.read('mode'), THERMOSTAT_MODE.HEATING);
  assert.deepEqual(heating.write('mode', THERMOSTAT_MODE.COOLING), ['setOperatingMode/2']);
  heating.values.set(C.heating.states.operatingMode, 4);
  assert.deepEqual(
    heating.write('mode', THERMOSTAT_MODE.AUTO),
    ['setOperatingMode/3'],
    'stays in the manual family',
  );
  assert.throws(() => heating.write('mode', THERMOSTAT_MODE.OFF), /off in Loxone/);
  heating.values.set(C.heating.states.operatingMode, -1);
  assert.equal(heating.read('mode'), THERMOSTAT_MODE.OFF);
  assert.equal(heating.read('preset'), THERMOSTAT_PRESET.COMFORT);
  assert.deepEqual(
    heating.feature('preset').supported_options.map((o) => o.label),
    ['Schedule', 'Éco', 'Confort', 'Hors-gel'],
  );
  assert.deepEqual(heating.write('preset', THERMOSTAT_PRESET.FROST), ['override/2']);
  assert.throws(() => heating.write('preset', THERMOSTAT_PRESET.NIGHT), /no preset/);
  heating.values.set(C.heating.states.activeMode, 3);
  assert.equal(heating.read('preset'), undefined, 'manual: no preset');
  const us = mapped(C.heating, { unit: 'F' });
  assert.deepEqual([us.feature('setpoint').min, us.feature('setpoint').unit], [40, U.FAHRENHEIT]);
});

test('InfoOnlyAnalog: the kind and the unit from the format', () => {
  const outside = mapped(C.outside);
  assert.deepEqual(
    [outside.entry.features[0].key, outside.entry.features[0].unit],
    ['temperature', U.CELSIUS],
  );
  assert.equal(outside.read('temperature'), 12.3);
  assert.deepEqual(outside.entry.throttled, ['temperature']);
  assert.equal(mapped(C.bathHumidity).feature('humidity').unit, U.PERCENT);
  assert.equal(mapped(C.daylight).read('illuminance'), 15400);
  const counter = mapped(C.counter);
  assert.deepEqual(
    [counter.feature('value').category, counter.feature('value').unit],
    [CAT.UNKNOWN, undefined],
  );
  assert.deepEqual(measurementOf('°F', 'x'), {
    kind: 'temperature',
    unit: U.FAHRENHEIT,
    temperature: 'F',
  });
  assert.equal(measurementOf('°', 'x', 'F').unit, U.FAHRENHEIT);
  assert.equal(measurementOf('%', 'Batterie volet').kind, 'battery');
  assert.equal(measurementOf('klx', 'x').factor, 1000);
  assert.equal(measurementOf('kWh', 'x').kind, 'energy');
  assert.equal(measurementOf('furlongs', 'x').kind, 'value');
});

test('InfoOnlyDigital: opening contacts by their texts, motion, generic input', () => {
  const window = mapped(C.kitchenWindow);
  assert.equal(window.feature('opening').category, CAT.OPENING_SENSOR);
  assert.equal(window.read('opening'), OPENING_SENSOR_STATE.CLOSE);
  window.values.set(C.kitchenWindow.states.active, 1);
  assert.equal(window.read('opening'), OPENING_SENSOR_STATE.OPEN);
  assert.deepEqual(
    digitalKind({ name: 'x', details: { text: { on: 'Geschlossen', off: 'Offen' } } }),
    { kind: 'opening', openWhenActive: false },
  );
  assert.equal(mapped(C.hallMotion).feature('motion').category, CAT.MOTION_SENSOR);
  const armed = mapped(C.alarmArmed);
  assert.deepEqual([armed.feature('input').category, armed.read('input')], [CAT.INPUT, 1]);
});

test('InfoOnlyText, Meter, PresenceDetector', () => {
  const pump = mapped(C.pump);
  assert.deepEqual([pump.feature('text').category, pump.read('text')], [CAT.TEXT, 'Marche']);
  const house = mapped(C.house);
  assert.deepEqual(
    house.entry.features.map((f) => [f.key, f.type, f.unit]),
    [
      ['power', T.ENERGY_SENSOR.POWER, U.KILOWATT],
      ['energy', T.ENERGY_SENSOR.INDEX, U.KILOWATT_HOUR],
    ],
  );
  const grid = mapped(C.grid);
  assert.deepEqual(
    grid.entry.features.map((f) => [f.key, f.category, f.type]),
    [
      ['power', CAT.GRID_SENSOR, T.GRID_SENSOR.POWER],
      ['energy', CAT.GRID_SENSOR, T.GRID_SENSOR.INPUT_INDEX],
      ['energy-export', CAT.GRID_SENSOR, T.GRID_SENSOR.OUTPUT_INDEX],
    ],
  );
  assert.equal(grid.read('power'), -0.85);
  const water = mapped(C.water);
  assert.deepEqual(
    water.entry.features.map((f) => [f.key, f.unit]),
    [['volume', U.CUBIC_METER]],
    'a flow in l/h is not offered yet',
  );
  assert.equal(mapControl(controlOf(C.battery)).length, 0, 'storage meters: later');
  assert.equal(mapped(C.presence).read('motion'), 1);
});

test('read-only and secured controls have no writer; unsupported types map to nothing', () => {
  const safe = mapped(C.safe);
  assert.equal(safe.feature('binary').read_only, true);
  assert.deepEqual(safe.entry.writers, {});
  assert.equal(mapControl(controlOf(C.music)).length, 0);
  assert.deepEqual(moodsOf('nope'), []);
});
