// -----------------------------------------------------------------------------
// One Loxone control -> Gladys devices, their features, readers and writers
// (pure).
//
// The control types, their states and commands follow Loxone's "Structure
// File" document (16.0); matterbridge-loxone, homebridge-loxone-proxy and
// ioBroker.loxone were read for the field behaviour (see README credits).
// `mapControl` returns one entry per Gladys device (a lighting controller gives
// one device for its moods and one per light circuit):
//   uuid       the control UUID the device stands for (part of its external id),
//   features   the Gladys features (key relative to the device),
//   readers    [{ key, deps, read(get), event? }]: the feature is read again when
//              one of the `deps` state UUIDs changes; get(uuid) returns the last
//              value of a state (a number, or a string for the text states);
//              `event` features go through publishStates, every value in order,
//   writers    { [key]: (value, get) -> [{ uuid, command }] },
//   throttled  the keys of the measurements (spaced by the sensor interval),
//   optimistic the keys without a state to read: Gladys keeps the value sent,
//   watch      state UUIDs whose change re-publishes the devices (mood lists),
//   health     { deps, read(get) -> true when the Loxone device is offline }.
// Value conventions: the Gladys side follows the enums of server/utils/constants.js.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { LIMITS } from './constants.js';
import {
  clamp,
  hsvToInt,
  intToHueSat,
  parseColor,
  parseJson,
  round,
  toNumber,
  unitOfFormat,
} from './values.js';

// Value enums of the Gladys core (server/utils/constants.js), not in the SDK.
export const COVER_STATE = { STOP: 0, OPEN: 1, CLOSE: -1 };
export const OPENING_SENSOR_STATE = { OPEN: 0, CLOSE: 1 };
export const THERMOSTAT_MODE = { OFF: 0, HEATING: 1, COOLING: 2, AUTO: 3 };
export const THERMOSTAT_PRESET = { SCHEDULE: 0, FROST: 1, AWAY: 2, ECO: 3, NIGHT: 4, COMFORT: 5 };

/** LightControllerV2 moods: 778 is "off", 777 "all on" (matterbridge-loxone). */
export const MOOD = { OFF: 778, ALL_ON: 777 };

/** Shown by a text feature with nothing to say (an empty text is not a state). */
export const EMPTY_TEXT = '—';

/** The control types mapped by this version (the others are listed by the connection test). */
export const SUPPORTED_TYPES = [
  'Switch',
  'TimedSwitch',
  'Pushbutton',
  'Dimmer',
  'EIBDimmer',
  'ColorPickerV2',
  'LightControllerV2',
  'Jalousie',
  'CentralJalousie',
  'Gate',
  'CentralGate',
  'Window',
  'CentralWindow',
  'IRoomControllerV2',
  'InfoOnlyAnalog',
  'InfoOnlyDigital',
  'InfoOnlyText',
  'Meter',
  'PresenceDetector',
];

/** A state value as 1/0 (any non-zero number is on). */
const binaryOf = (raw) => {
  const n = toNumber(raw);
  return n === undefined ? undefined : n !== 0 ? 1 : 0;
};

// --- Units -----------------------------------------------------------------------

const TEMPERATURE_UNITS = { C: U.CELSIUS, F: U.FAHRENHEIT };

/** What an analog value is, from the unit of its format (and its name for "%"). */
export function measurementOf(unitText, name, boxUnit = 'C') {
  const unit = unitText.replace(/\s+/g, '');
  const lower = unit.toLowerCase();
  if (unit === '°' || unit === '°C' || unit === '°F' || unit === 'C' || unit === 'F') {
    const t = unit.endsWith('F') ? 'F' : unit.endsWith('C') ? 'C' : boxUnit;
    return { kind: 'temperature', unit: TEMPERATURE_UNITS[t], temperature: t };
  }
  if (unit === '%') {
    if (/humid|feucht|hygro/i.test(name)) {
      return { kind: 'humidity', unit: U.PERCENT };
    }
    if (/batter|akku|accu/i.test(name)) {
      return { kind: 'battery', unit: U.PERCENT };
    }
    return { kind: 'percent', unit: U.PERCENT };
  }
  const table = {
    lx: { kind: 'illuminance', unit: U.LUX },
    lux: { kind: 'illuminance', unit: U.LUX },
    klx: { kind: 'illuminance', unit: U.LUX, factor: 1000 },
    w: { kind: 'power', unit: U.WATT },
    kw: { kind: 'power', unit: U.KILOWATT },
    wh: { kind: 'energy', unit: U.WATT_HOUR },
    kwh: { kind: 'energy', unit: U.KILOWATT_HOUR },
    mwh: { kind: 'energy', unit: U.MEGAWATT_HOUR },
    v: { kind: 'voltage', unit: U.VOLT },
    a: { kind: 'current', unit: U.AMPERE },
    ma: { kind: 'current', unit: U.MILLI_AMPERE },
    ppm: { kind: 'co2', unit: U.PPM },
    hpa: { kind: 'pressure', unit: U.HECTO_PASCAL },
    mbar: { kind: 'pressure', unit: U.MILLIBAR },
    bar: { kind: 'pressure', unit: U.BAR },
    'm/s': { kind: 'speed', unit: U.METER_PER_SECOND },
    'km/h': { kind: 'speed', unit: U.KILOMETER_PER_HOUR },
    mm: { kind: 'precipitation', unit: U.MM },
    'mm/h': { kind: 'precipitation', unit: U.MILLIMETER_PER_HOUR },
    db: { kind: 'noise', unit: U.DECIBEL },
    'm³': { kind: 'volume', unit: U.CUBIC_METER },
    m3: { kind: 'volume', unit: U.CUBIC_METER },
    l: { kind: 'volume', unit: U.LITER },
    '€': { kind: 'currency', unit: U.EURO },
    $: { kind: 'currency', unit: U.DOLLAR },
  };
  return table[lower] ?? { kind: 'value' };
}

const MEASUREMENTS = {
  temperature: (m) => ({
    category: C.TEMPERATURE_SENSOR,
    type: T.SENSOR.DECIMAL,
    min: m.temperature === 'F' ? -150 : -100,
    max: m.temperature === 'F' ? 300 : 150,
  }),
  humidity: () => ({ category: C.HUMIDITY_SENSOR, type: T.SENSOR.DECIMAL, min: 0, max: 100 }),
  battery: () => ({ category: C.BATTERY, type: T.BATTERY.INTEGER, min: 0, max: 100 }),
  illuminance: () => ({ category: C.LIGHT_SENSOR, type: T.SENSOR.DECIMAL, min: 0, max: 200_000 }),
  power: () => ({ category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.POWER, min: -1e9, max: 1e9 }),
  energy: () => ({ category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.INDEX, min: 0, max: 1e12 }),
  voltage: () => ({ category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.VOLTAGE, min: 0, max: 1e6 }),
  current: () => ({ category: C.ENERGY_SENSOR, type: T.ENERGY_SENSOR.CURRENT, min: 0, max: 1e6 }),
  co2: () => ({ category: C.CO2_SENSOR, type: T.SENSOR.DECIMAL, min: 0, max: 100_000 }),
  pressure: () => ({ category: C.PRESSURE_SENSOR, type: T.SENSOR.DECIMAL, min: 0, max: 100_000 }),
  speed: () => ({ category: C.SPEED_SENSOR, type: T.SPEED_SENSOR.DECIMAL, min: 0, max: 1000 }),
  precipitation: () => ({
    category: C.PRECIPITATION_SENSOR,
    type: T.PRECIPITATION_SENSOR.DECIMAL,
    min: 0,
    max: 10_000,
  }),
  noise: () => ({ category: C.NOISE_SENSOR, type: T.SENSOR.DECIMAL, min: 0, max: 200 }),
  volume: () => ({ category: C.VOLUME_SENSOR, type: T.VOLUME_SENSOR.DECIMAL, min: 0, max: 1e12 }),
  currency: () => ({ category: C.CURRENCY, type: T.CURRENCY.DECIMAL, min: -1e9, max: 1e9 }),
  percent: () => ({ category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: 0, max: 100 }),
  value: () => ({ category: C.UNKNOWN, type: T.UNKNOWN.UNKNOWN, min: -1e9, max: 1e9 }),
};

const NAMES = {
  temperature: 'Temperature',
  humidity: 'Humidity',
  battery: 'Battery',
  illuminance: 'Illuminance',
  power: 'Power',
  energy: 'Energy',
  voltage: 'Voltage',
  current: 'Current',
  co2: 'CO2',
  pressure: 'Pressure',
  speed: 'Speed',
  precipitation: 'Precipitation',
  noise: 'Noise',
  volume: 'Volume',
  currency: 'Amount',
  percent: 'Value',
  value: 'Value',
};

// --- Texts of the digital states -----------------------------------------------------

const OPEN_WORDS = /^(open|opened|offen|geöffnet|auf|ouvert|ouverte|aperto|abierto|otevřeno)$/i;
const CLOSED_WORDS = /^(closed|geschlossen|zu|fermé|fermée|ferme|chiuso|cerrado|zavřeno)$/i;
const MOTION_WORDS = /motion|bewegung|mouvement|präsenz|presence|présence|anwesen|movimento/i;

/** An InfoOnlyDigital: an opening contact (and its polarity), a motion sensor or an input. */
export function digitalKind(control) {
  const on = String(control.details?.text?.on ?? '').trim();
  const off = String(control.details?.text?.off ?? '').trim();
  if (OPEN_WORDS.test(on) || CLOSED_WORDS.test(off)) {
    return { kind: 'opening', openWhenActive: true };
  }
  if (CLOSED_WORDS.test(on) || OPEN_WORDS.test(off)) {
    return { kind: 'opening', openWhenActive: false };
  }
  if (MOTION_WORDS.test(on) || MOTION_WORDS.test(control.name)) {
    return { kind: 'motion' };
  }
  return { kind: 'input' };
}

// --- Moods -------------------------------------------------------------------------

/** The mood list of a lighting controller: [{ id, name }] without "off". */
export function moodsOf(raw) {
  const list = parseJson(raw);
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .filter((m) => m && Number.isInteger(m.id))
    .map((m) => ({ id: m.id, name: String(m.name ?? '').trim() || `#${m.id}` }));
}

const activeMoodsOf = (raw) => {
  const list = parseJson(raw);
  return Array.isArray(list) ? list.filter((id) => Number.isInteger(id)) : undefined;
};

// --- Colors --------------------------------------------------------------------------

const colorCommand = (c) =>
  c.kelvin !== undefined
    ? `temp(${Math.round(c.brightness)},${Math.round(c.kelvin)})`
    : `hsv(${Math.round(c.h)},${Math.round(c.s)},${Math.round(c.v)})`;

/** The last color of a picker with another brightness (white when unknown). */
const withBrightness = (raw, value) => {
  const c = parseColor(raw) ?? { h: 0, s: 0, v: 0 };
  return c.kelvin !== undefined ? { ...c, brightness: value } : { ...c, v: value };
};

// --- The control -----------------------------------------------------------------------

const cmd = (uuid, command) => ({ uuid, command });

class DeviceMapper {
  constructor(control, { name, uuid, unit = 'C', light = false } = {}) {
    this.control = control;
    this.uuid = uuid ?? control.uuid;
    /** the UUID the commands go to, as the structure file writes it */
    this.action = control.uuidAction ?? this.uuid;
    this.name = name ?? control.name;
    this.boxUnit = unit;
    this.light = light;
    this.readOnly = Boolean(control.readOnly);
    this.features = [];
    this.readers = [];
    this.writers = {};
    this.throttled = [];
    this.optimistic = [];
    this.watch = [];
    this.health = undefined;
  }

  /** The UUID of a state of this control (or of another one). */
  st(name, control = this.control) {
    return control.states?.[name];
  }

  /**
   * One feature.
   * @param {string} key part of the external id: never change it
   * @param {string} name
   * @param {object} spec category, type, min, max, unit, step, keepHistory, options
   * @param {{ deps?: string[], read?: Function, write?: Function, throttle?: boolean, event?: boolean }} io
   */
  add(key, name, spec, { deps = [], read, write, throttle = false, event = false } = {}) {
    if (this.features.some((f) => f.key === key)) {
      return;
    }
    const writable = Boolean(write) && !this.readOnly;
    const live = deps.filter(Boolean);
    const feature = {
      key,
      name,
      category: spec.category,
      type: spec.type,
      min: spec.min ?? 0,
      max: spec.max ?? 1,
      read_only: !writable,
      has_feedback: Boolean(writable && read),
      keep_history: spec.keepHistory ?? true,
    };
    if (spec.unit) {
      feature.unit = spec.unit;
    }
    if (spec.step) {
      feature.step = spec.step;
    }
    if (spec.options) {
      feature.supported_options = spec.options;
    }
    this.features.push(feature);
    if (read && live.length > 0) {
      this.readers.push({ key, deps: live, read, event });
    } else if (writable) {
      this.optimistic.push(key);
    }
    if (writable) {
      this.writers[key] = write;
    }
    if (throttle) {
      this.throttled.push(key);
    }
  }

  // --- Switches and lights ---

  onOff({ category, type, state, isOn = (v) => binaryOf(v), on = 'on', off = 'off', event }) {
    const uuid = this.action;
    this.add(
      'binary',
      'On/off',
      { category, type },
      {
        deps: [this.st(state)],
        read: (get) => isOn(get(this.st(state))),
        write: (value) => [cmd(uuid, Number(value) !== 0 ? on : off)],
        event,
      },
    );
  }

  switchKind() {
    return this.light || this.control.catType === 'lights'
      ? { category: C.LIGHT, type: T.LIGHT.BINARY }
      : { category: C.SWITCH, type: T.SWITCH.BINARY };
  }

  switch() {
    this.onOff({ ...this.switchKind(), state: 'active' });
  }

  timedSwitch() {
    // deactivationDelay: 0 off, -1 on for good, otherwise the countdown.
    this.onOff({ ...this.switchKind(), state: 'deactivationDelay' });
  }

  pushbutton() {
    // A press is 1 then 0 within a second: every change is sent, in order.
    this.onOff({
      category: C.SWITCH,
      type: T.SWITCH.BINARY,
      state: 'active',
      on: 'pulse',
      event: true,
    });
  }

  dimmer() {
    const uuid = this.action;
    const position = this.st('position');
    this.onOff({
      category: C.LIGHT,
      type: T.LIGHT.BINARY,
      state: 'position',
      isOn: (v) => {
        const n = toNumber(v);
        return n === undefined ? undefined : n > 0 ? 1 : 0;
      },
    });
    this.add(
      'brightness',
      'Brightness',
      { category: C.LIGHT, type: T.LIGHT.BRIGHTNESS, min: 0, max: 100, unit: U.PERCENT },
      {
        deps: [position],
        read: (get) => {
          const n = toNumber(get(position));
          return n === undefined ? undefined : clamp(Math.round(n), 0, 100);
        },
        write: (value) => [cmd(uuid, String(clamp(Math.round(Number(value) || 0), 0, 100)))],
      },
    );
  }

  colorPicker() {
    const uuid = this.action;
    const color = this.st('color');
    const tunableOnly = this.control.details?.pickerType === 'TunableWhite';
    const brightnessOf = (raw) => {
      const c = parseColor(raw);
      if (!c) {
        return undefined;
      }
      return Math.round(c.kelvin !== undefined ? c.brightness : c.v);
    };
    const spec = { category: C.LIGHT, type: T.LIGHT.BINARY };
    this.add('binary', 'On/off', spec, {
      deps: [color],
      read: (get) => {
        const b = brightnessOf(get(color));
        return b === undefined ? undefined : b > 0 ? 1 : 0;
      },
      write: (value, get) => [
        cmd(uuid, colorCommand(withBrightness(get(color), Number(value) !== 0 ? 100 : 0))),
      ],
    });
    this.add(
      'brightness',
      'Brightness',
      { category: C.LIGHT, type: T.LIGHT.BRIGHTNESS, min: 0, max: 100, unit: U.PERCENT },
      {
        deps: [color],
        read: (get) => brightnessOf(get(color)),
        write: (value, get) => [
          cmd(uuid, colorCommand(withBrightness(get(color), clamp(Number(value) || 0, 0, 100)))),
        ],
      },
    );
    if (!tunableOnly) {
      this.add(
        'color',
        'Color',
        { category: C.LIGHT, type: T.LIGHT.COLOR, min: 0, max: 0xffffff },
        {
          deps: [color],
          read: (get) => {
            const c = parseColor(get(color));
            // A white (temperature) mode has no RGB color: the last one stays.
            return c && c.kelvin === undefined ? hsvToInt(c) : undefined;
          },
          write: (value, get) => {
            const { h, s } = intToHueSat(value);
            const current = parseColor(get(color));
            const v =
              current?.v > 0 ? current.v : current?.brightness > 0 ? current.brightness : 100;
            return [cmd(uuid, colorCommand({ h, s, v }))];
          },
        },
      );
    }
  }

  /** A light circuit of a lighting controller, by its own type. */
  circuit() {
    switch (this.control.type) {
      case 'Switch':
        return this.onOff({ category: C.LIGHT, type: T.LIGHT.BINARY, state: 'active' });
      case 'Dimmer':
      case 'EIBDimmer':
        return this.dimmer();
      case 'ColorPickerV2':
        return this.colorPicker();
      default:
        return undefined;
    }
  }

  /** The moods of a lighting controller, its on/off and its master brightness. */
  lightController(get) {
    const uuid = this.action;
    const active = this.st('activeMoods');
    const list = this.st('moodList');
    const favorites = this.st('favoriteMoods');
    const moods = moodsOf(get(list));
    // "Off" first, with the name the Miniserver gives it ("Tout éteint", "Alles aus"…).
    const off = moods.find((m) => m.id === MOOD.OFF)?.name || 'Off';
    const options = [
      { value: String(MOOD.OFF), label: off },
      ...moods
        .filter((m) => m.id !== MOOD.OFF)
        .map((m) => ({ value: String(m.id), label: m.name })),
    ].slice(0, LIMITS.options);
    if (list) {
      this.watch.push(list);
    }
    this.add(
      'binary',
      'On/off',
      { category: C.LIGHT, type: T.LIGHT.BINARY },
      {
        deps: [active],
        read: (g) => {
          const ids = activeMoodsOf(g(active));
          if (!ids) {
            return undefined;
          }
          return ids.length === 0 || (ids.length === 1 && ids[0] === MOOD.OFF) ? 0 : 1;
        },
        write: (value, g) => {
          if (Number(value) === 0) {
            return [cmd(uuid, `changeTo/${MOOD.OFF}`)];
          }
          const known = moodsOf(g(list)).map((m) => m.id);
          const favorite = (parseJson(g(favorites)) ?? []).find(
            (id) => Number.isInteger(id) && id !== MOOD.OFF,
          );
          const mood = known.includes(MOOD.ALL_ON)
            ? MOOD.ALL_ON
            : (favorite ?? known.find((id) => id !== MOOD.OFF) ?? MOOD.ALL_ON);
          return [cmd(uuid, `changeTo/${mood}`)];
        },
      },
    );
    this.add(
      'mood',
      'Mood',
      { category: C.TEXT, type: T.TEXT.SELECT, keepHistory: false, options },
      {
        deps: [active],
        read: (g) => {
          const ids = activeMoodsOf(g(active));
          // Several moods mixed: the first one is shown.
          return ids && ids.length > 0 ? String(ids[0]) : undefined;
        },
        write: (value) => {
          const id = Number(String(value ?? '').trim());
          if (!Number.isInteger(id)) {
            throw new Error(`"${value}" is not a mood of ${this.name}`);
          }
          return [cmd(uuid, `changeTo/${id}`)];
        },
      },
    );
    const masterId = String(this.control.details?.masterValue ?? '').toLowerCase();
    const master = this.control.subControls?.find((s) => s.uuid === masterId);
    const position = master && this.st('position', master);
    if (position) {
      this.add(
        'brightness',
        'Master brightness',
        { category: C.LIGHT, type: T.LIGHT.BRIGHTNESS, min: 0, max: 100, unit: U.PERCENT },
        {
          deps: [position],
          read: (g) => {
            const n = toNumber(g(position));
            return n === undefined ? undefined : clamp(Math.round(n), 0, 100);
          },
          write: (value) => [
            cmd(
              master.uuidAction ?? master.uuid,
              String(clamp(Math.round(Number(value) || 0), 0, 100)),
            ),
          ],
        },
      );
    }
  }

  // --- Covers ---

  coverKind() {
    // Jalousie animation 2, 4, 5: curtains.
    const animation = Number(this.control.details?.animation);
    return [2, 4, 5].includes(animation)
      ? { category: C.CURTAIN, position: T.CURTAIN.POSITION, state: T.CURTAIN.STATE }
      : { category: C.SHUTTER, position: T.SHUTTER.POSITION, state: T.SHUTTER.STATE };
  }

  /** The open / close / stop feature. */
  coverState(kind, { deps = [], read, open, close, stop }) {
    const uuid = this.action;
    this.add(
      'state',
      'Open/close',
      { category: kind.category, type: kind.state, min: -1, max: 1, keepHistory: false },
      {
        deps,
        read,
        write: (value) => {
          const wanted = Number(value);
          if (wanted === COVER_STATE.OPEN) {
            return [cmd(uuid, open)];
          }
          if (wanted === COVER_STATE.CLOSE) {
            return [cmd(uuid, close)];
          }
          if (wanted === COVER_STATE.STOP) {
            return [cmd(uuid, stop)];
          }
          throw new Error(`${this.name} cannot do ${value}`);
        },
      },
    );
  }

  /** Moving up/opening -> OPEN, down/closing -> CLOSE, idle -> STOP. */
  static motion(opening, closing) {
    if (opening === undefined && closing === undefined) {
      return undefined;
    }
    if (opening) {
      return COVER_STATE.OPEN;
    }
    return closing ? COVER_STATE.CLOSE : COVER_STATE.STOP;
  }

  jalousie() {
    const uuid = this.action;
    const kind = this.coverKind();
    const position = this.st('position');
    const up = this.st('up');
    const down = this.st('down');
    // Loxone: 0 = upper position (open), 1 = lower position (closed). Gladys: 100 = open.
    this.add(
      'position',
      'Position',
      { category: kind.category, type: kind.position, min: 0, max: 100, unit: U.PERCENT },
      {
        deps: [position],
        read: (get) => {
          const p = toNumber(get(position));
          return p === undefined ? undefined : clamp(Math.round((1 - p) * 100), 0, 100);
        },
        write: (value) => {
          const v = clamp(Math.round(Number(value) || 0), 0, 100);
          // The end positions recalibrate the blind: full moves rather than 0 / 100.
          if (v >= 100) {
            return [cmd(uuid, 'FullUp')];
          }
          return [cmd(uuid, v <= 0 ? 'FullDown' : `manualPosition/${100 - v}`)];
        },
      },
    );
    this.coverState(kind, {
      deps: [up, down],
      read: (get) => DeviceMapper.motion(binaryOf(get(up)), binaryOf(get(down))),
      open: 'FullUp',
      close: 'FullDown',
      stop: 'stop',
    });
    const deviceState = this.st('deviceState');
    if (deviceState) {
      // 0 no device, 1 offline, 2 online (Air / Tree motors).
      this.health = { deps: [deviceState], read: (get) => toNumber(get(deviceState)) === 1 };
    }
  }

  gate() {
    const position = this.st('position');
    const active = this.st('active');
    const kind = { category: C.SHUTTER, position: T.SHUTTER.POSITION, state: T.SHUTTER.STATE };
    // Loxone: 1 = open, 0 = closed; the gate cannot be sent to a position.
    this.add(
      'position',
      'Position',
      { category: kind.category, type: kind.position, min: 0, max: 100, unit: U.PERCENT },
      {
        deps: [position],
        read: (get) => {
          const p = toNumber(get(position));
          return p === undefined ? undefined : clamp(Math.round(p * 100), 0, 100);
        },
      },
    );
    this.coverState(kind, {
      deps: [active],
      read: (get) => {
        const a = toNumber(get(active));
        return a === undefined ? undefined : DeviceMapper.motion(a > 0, a < 0);
      },
      open: 'open',
      close: 'close',
      stop: 'stop',
    });
  }

  window() {
    const uuid = this.action;
    const position = this.st('position');
    const direction = this.st('direction');
    const kind = { category: C.SHUTTER, position: T.SHUTTER.POSITION, state: T.SHUTTER.STATE };
    // Loxone: 0 = fully closed, 1 = fully open; moveToPosition 0–100 the same way.
    this.add(
      'position',
      'Position',
      { category: kind.category, type: kind.position, min: 0, max: 100, unit: U.PERCENT },
      {
        deps: [position],
        read: (get) => {
          const p = toNumber(get(position));
          return p === undefined ? undefined : clamp(Math.round(p * 100), 0, 100);
        },
        write: (value) => {
          const v = clamp(Math.round(Number(value) || 0), 0, 100);
          if (v >= 100) {
            return [cmd(uuid, 'fullopen')];
          }
          return [cmd(uuid, v <= 0 ? 'fullclose' : `moveToPosition/${v}`)];
        },
      },
    );
    this.coverState(kind, {
      deps: [direction],
      read: (get) => {
        const d = toNumber(get(direction));
        return d === undefined ? undefined : DeviceMapper.motion(d > 0, d < 0);
      },
      open: 'fullopen',
      close: 'fullclose',
      stop: 'stop',
    });
  }

  /** A central object: open / close / stop only, no state to read. */
  central(open, close, stop) {
    this.coverState(
      { category: C.SHUTTER, position: T.SHUTTER.POSITION, state: T.SHUTTER.STATE },
      { open, close, stop },
    );
  }

  // --- Room controller ---

  roomController() {
    const uuid = this.action;
    const unit = this.boxUnit;
    const [low, high] = unit === 'F' ? [40, 95] : [5, 35];
    const actual = this.st('tempActual');
    const target = this.st('tempTarget');
    const operatingMode = this.st('operatingMode');
    const activeMode = this.st('activeMode');
    this.add(
      'temperature',
      'Temperature',
      {
        category: C.TEMPERATURE_SENSOR,
        type: T.SENSOR.DECIMAL,
        min: unit === 'F' ? -150 : -100,
        max: unit === 'F' ? 300 : 150,
        unit: TEMPERATURE_UNITS[unit],
      },
      {
        deps: [actual],
        read: (get) => {
          const n = toNumber(get(actual));
          return n === undefined || n <= -1000 ? undefined : round(n, 2);
        },
        throttle: true,
      },
    );
    this.add(
      'setpoint',
      'Setpoint',
      {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.TARGET_TEMPERATURE,
        min: low,
        max: high,
        step: 0.5,
        unit: TEMPERATURE_UNITS[unit],
      },
      {
        deps: [target],
        read: (get) => {
          const n = toNumber(get(target));
          return n === undefined ? undefined : round(n, 2);
        },
        // A manual override with no end, as ioBroker.loxone does: the schedule
        // comes back with the "Schedule" preset.
        write: (value) => [cmd(uuid, `override/3//${round(clamp(Number(value), low, high), 1)}`)],
      },
    );
    // operatingMode: 0–2 automatic, 3–5 manual (heat + cool, heat only, cool only), -1 off.
    const MODES = {
      [-1]: THERMOSTAT_MODE.OFF,
      0: THERMOSTAT_MODE.AUTO,
      1: THERMOSTAT_MODE.HEATING,
      2: THERMOSTAT_MODE.COOLING,
      3: THERMOSTAT_MODE.AUTO,
      4: THERMOSTAT_MODE.HEATING,
      5: THERMOSTAT_MODE.COOLING,
    };
    const OFFSETS = {
      [THERMOSTAT_MODE.AUTO]: 0,
      [THERMOSTAT_MODE.HEATING]: 1,
      [THERMOSTAT_MODE.COOLING]: 2,
    };
    this.add(
      'mode',
      'Mode',
      { category: C.THERMOSTAT, type: T.THERMOSTAT.MODE, min: 0, max: 3, keepHistory: false },
      {
        deps: [operatingMode],
        read: (get) => MODES[toNumber(get(operatingMode))],
        write: (value, get) => {
          const offset = OFFSETS[Number(value)];
          if (offset === undefined) {
            throw new Error(`${this.name}: turn the room controller off in Loxone`);
          }
          // Stay in the manual family when the controller is in it.
          const manual = (toNumber(get(operatingMode)) ?? 0) >= 3;
          return [cmd(uuid, `setOperatingMode/${offset + (manual ? 3 : 0)}`)];
        },
      },
    );
    // activeMode: 0 economy, 1 comfort, 2 building protection, 3 manual, 4 off.
    const PRESETS = {
      0: THERMOSTAT_PRESET.ECO,
      1: THERMOSTAT_PRESET.COMFORT,
      2: THERMOSTAT_PRESET.FROST,
    };
    const named = new Map(
      (Array.isArray(this.control.details?.timerModes) ? this.control.details.timerModes : [])
        .filter((m) => m && Number.isInteger(m.id))
        .map((m) => [m.id, String(m.name ?? '').trim()]),
    );
    const options = [
      { value: THERMOSTAT_PRESET.SCHEDULE, label: 'Schedule' },
      { value: THERMOSTAT_PRESET.ECO, label: named.get(0) || 'Economy' },
      { value: THERMOSTAT_PRESET.COMFORT, label: named.get(1) || 'Comfort' },
      { value: THERMOSTAT_PRESET.FROST, label: named.get(2) || 'Building protection' },
    ];
    this.add(
      'preset',
      'Preset',
      {
        category: C.THERMOSTAT,
        type: T.THERMOSTAT.PRESET,
        min: 0,
        max: 5,
        keepHistory: false,
        options,
      },
      {
        deps: [activeMode],
        read: (get) => PRESETS[toNumber(get(activeMode))],
        write: (value) => {
          const wanted = Number(value);
          if (wanted === THERMOSTAT_PRESET.SCHEDULE) {
            return [cmd(uuid, 'stopOverride')];
          }
          const id = Object.entries(PRESETS).find(([, p]) => p === wanted)?.[0];
          if (id === undefined) {
            throw new Error(`${this.name} has no preset ${value}`);
          }
          return [cmd(uuid, `override/${id}`)];
        },
      },
    );
  }

  // --- Sensors ---

  measurement(key, name, m, state, { factor = 1 } = {}) {
    const uuid = this.st(state);
    const spec = MEASUREMENTS[m.kind](m);
    this.add(
      key,
      name,
      { ...spec, unit: m.unit },
      {
        deps: [uuid],
        read: (get) => {
          const n = toNumber(get(uuid));
          if (n === undefined) {
            return undefined;
          }
          const v = round(n * factor * (m.factor ?? 1), 3);
          return m.kind === 'battery' ? clamp(Math.round(v), 0, 100) : v;
        },
        throttle: true,
      },
    );
  }

  infoAnalog() {
    const m = measurementOf(unitOfFormat(this.control.details?.format), this.name, this.boxUnit);
    this.measurement(m.kind, NAMES[m.kind], m, 'value');
  }

  infoDigital() {
    const active = this.st('active');
    const d = digitalKind(this.control);
    if (d.kind === 'opening') {
      this.add(
        'opening',
        'Opening',
        { category: C.OPENING_SENSOR, type: T.SENSOR.BINARY },
        {
          deps: [active],
          read: (get) => {
            const b = binaryOf(get(active));
            if (b === undefined) {
              return undefined;
            }
            return (b === 1) === d.openWhenActive
              ? OPENING_SENSOR_STATE.OPEN
              : OPENING_SENSOR_STATE.CLOSE;
          },
        },
      );
      return;
    }
    const spec =
      d.kind === 'motion'
        ? { category: C.MOTION_SENSOR, type: T.SENSOR.BINARY }
        : { category: C.INPUT, type: T.INPUT.BINARY };
    this.add(d.kind, d.kind === 'motion' ? 'Motion' : 'State', spec, {
      deps: [active],
      read: (get) => binaryOf(get(active)),
    });
  }

  infoText() {
    const state = this.st('text');
    this.add(
      'text',
      'Text',
      { category: C.TEXT, type: T.TEXT.TEXT, max: 0, keepHistory: false },
      {
        deps: [state],
        read: (get) => {
          const raw = get(state);
          if (raw === undefined) {
            return undefined;
          }
          const t = String(raw).trim().slice(0, LIMITS.text);
          return t || EMPTY_TEXT;
        },
      },
    );
  }

  meter() {
    const details = this.control.details ?? {};
    const type = String(details.type ?? 'unidirectional').toLowerCase();
    if (type === 'storage') {
      return; // the charge level and its signs: a later version (TODO.md)
    }
    const power = measurementOf(unitOfFormat(details.actualFormat), this.name);
    const total = measurementOf(unitOfFormat(details.totalFormat), this.name);
    const bidirectional = type === 'bidirectional';
    if (power.kind === 'power') {
      if (bidirectional) {
        // Import > 0, export < 0: the signed grid power.
        this.add(
          'power',
          'Power',
          {
            category: C.GRID_SENSOR,
            type: T.GRID_SENSOR.POWER,
            min: -1e9,
            max: 1e9,
            unit: power.unit,
          },
          { deps: [this.st('actual')], read: this.readNumber('actual'), throttle: true },
        );
      } else {
        this.measurement('power', 'Power', power, 'actual');
      }
    }
    if (total.kind === 'energy' && bidirectional) {
      const neg = measurementOf(unitOfFormat(details.totalFormatNeg ?? details.totalFormat), '');
      const index = (key, name, type, state, unit) =>
        this.add(
          key,
          name,
          { category: C.GRID_SENSOR, type, min: 0, max: 1e12, unit },
          { deps: [this.st(state)], read: this.readNumber(state), throttle: true },
        );
      index('energy', 'Energy imported', T.GRID_SENSOR.INPUT_INDEX, 'total', total.unit);
      if (neg.kind === 'energy') {
        index('energy-export', 'Energy exported', T.GRID_SENSOR.OUTPUT_INDEX, 'totalNeg', neg.unit);
      }
    } else if (total.kind === 'energy' || total.kind === 'volume') {
      this.measurement(total.kind, NAMES[total.kind], total, 'total');
    }
  }

  readNumber(state) {
    const uuid = this.st(state);
    return (get) => {
      const n = toNumber(get(uuid));
      return n === undefined ? undefined : round(n, 3);
    };
  }

  presence() {
    const active = this.st('active');
    this.add(
      'motion',
      'Presence',
      { category: C.MOTION_SENSOR, type: T.SENSOR.BINARY },
      { deps: [active], read: (get) => binaryOf(get(active)) },
    );
  }

  map(get) {
    switch (this.control.type) {
      case 'Switch':
        this.switch();
        break;
      case 'TimedSwitch':
        this.timedSwitch();
        break;
      case 'Pushbutton':
        this.pushbutton();
        break;
      case 'Dimmer':
      case 'EIBDimmer':
        this.dimmer();
        break;
      case 'ColorPickerV2':
        this.colorPicker();
        break;
      case 'LightControllerV2':
        this.lightController(get);
        break;
      case 'Jalousie':
        this.jalousie();
        break;
      case 'CentralJalousie':
        this.central('FullUp', 'FullDown', 'stop');
        break;
      case 'Gate':
        this.gate();
        break;
      case 'CentralGate':
        this.central('open', 'close', 'stop');
        break;
      case 'Window':
        this.window();
        break;
      case 'CentralWindow':
        this.central('fullopen', 'fullclose', 'stop');
        break;
      case 'IRoomControllerV2':
        this.roomController();
        break;
      case 'InfoOnlyAnalog':
        this.infoAnalog();
        break;
      case 'InfoOnlyDigital':
        this.infoDigital();
        break;
      case 'InfoOnlyText':
        this.infoText();
        break;
      case 'Meter':
        this.meter();
        break;
      case 'PresenceDetector':
        this.presence();
        break;
      default:
        break;
    }
    return this.result();
  }

  result() {
    return {
      uuid: this.uuid,
      name: this.name,
      control: this.control,
      features: this.features,
      readers: this.readers,
      writers: this.writers,
      throttled: this.throttled,
      optimistic: this.optimistic,
      watch: this.watch,
      health: this.health,
    };
  }
}

/** The subcontrols of a lighting controller that are light circuits (not the masters). */
export function circuitsOf(control) {
  const masters = new Set(
    [control.details?.masterValue, control.details?.masterColor]
      .filter(Boolean)
      .map((u) => String(u).toLowerCase()),
  );
  return (control.subControls ?? []).filter(
    (s) => !masters.has(s.uuid) && !/\/master(value|color)$/i.test(s.uuid),
  );
}

/**
 * @param {object} control a control of src/structure.js
 * @param {{ unit?: 'C' | 'F', get?: (uuid: string) => unknown }} [context]
 *   the temperature unit of the Miniserver, and the last values (mood lists)
 * @returns {object[]} one entry per Gladys device, none when nothing maps
 */
export function mapControl(control, { unit = 'C', get = () => undefined } = {}) {
  const devices = [new DeviceMapper(control, { unit }).map(get)];
  if (control.type === 'LightControllerV2') {
    for (const sub of circuitsOf(control)) {
      const mapper = new DeviceMapper(sub, { unit, light: true });
      mapper.circuit();
      devices.push(mapper.result());
    }
  }
  return devices.filter((d) => d.features.length > 0);
}

/** A control type this version maps (it may still have nothing to offer: a storage meter…). */
export const isSupported = (type) => SUPPORTED_TYPES.includes(type);
