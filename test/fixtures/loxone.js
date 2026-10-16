// -----------------------------------------------------------------------------
// A structure file (LoxAPP3.json) of a small house and the values of its
// states, written after Loxone's "Structure File" document (16.0, 2025-06-03):
// msInfo, rooms, cats with their types, and one control of each type this
// integration maps, with the states, details and subcontrols the document
// lists (a LightControllerV2 with its master brightness, master color and
// light circuits "<uuid>/AI1"…). UUIDs follow the Miniserver format
// (8-4-4-16 hex), as in the test data of loxone-ts-api. No real installation
// was available: names and values are made up.
// -----------------------------------------------------------------------------

export const USER = 'gladys';
export const PASSWORD = 'lox-secret';
export const SERIAL = '504F94A0B1C2';
export const FIRMWARE = '15.2.10.14';

let next = 0;
/** A Miniserver-style UUID: 8-4-4-16 hex, lower case. */
const id = () => {
  next += 1;
  return `${(0x1a2b0000 + next).toString(16)}-03c4-2f17-ffff${(0x504f94a00000 + next).toString(16)}`;
};

const ROOMS = {
  salon: id(),
  chambre: id(),
  bureau: id(),
  entree: id(),
  exterieur: id(),
  garage: id(),
};
const CATS = { lights: id(), shading: id(), climate: id(), energy: id(), security: id() };

/** One control: { uuid, section } with its states as fresh UUIDs. */
function control(type, name, room, cat, stateNames, extra = {}) {
  const uuid = extra.uuid ?? id();
  const states = Object.fromEntries(stateNames.map((s) => [s, id()]));
  return {
    uuid,
    states,
    section: {
      name,
      type,
      uuidAction: uuid,
      defaultRating: 0,
      isSecured: false,
      ...(room ? { room: ROOMS[room] } : {}),
      ...(cat ? { cat: CATS[cat] } : {}),
      states,
      ...extra.section,
    },
  };
}

const lc = id();
const sub = (suffix, type, name, stateNames, section = {}) => {
  const uuid = `${lc}/${suffix}`;
  const states = Object.fromEntries(stateNames.map((s) => [s, id()]));
  return { uuid, states, section: { name, type, uuidAction: uuid, states, ...section } };
};
const DIMMER_STATES = ['position', 'min', 'max', 'step'];
const PICKER_STATES = ['color', 'sequence', 'sequenceColorIdx'];

export const SUB = {
  master: sub('masterValue', 'Dimmer', 'Master', DIMMER_STATES),
  masterColor: sub('masterColor', 'ColorPickerV2', 'Master color', PICKER_STATES),
  spots: sub('AI1', 'Dimmer', 'Spots', DIMMER_STATES),
  ledStrip: sub('AI2', 'ColorPickerV2', 'Ruban LED', PICKER_STATES, {
    details: { pickerType: 'Rgb' },
  }),
  floorLamp: sub('AQ1', 'Switch', 'Lampadaire', ['active']),
};

/** The controls, by a short key used in the tests. */
export const C = {
  plug: control('Switch', 'Prise TV', 'salon', 'energy', ['active', 'lockedOn']),
  lamp: control('Switch', "Lampe d'appoint", 'salon', 'lights', ['active', 'lockedOn']),
  stairs: control(
    'TimedSwitch',
    'Lumière escalier',
    'entree',
    'lights',
    ['deactivationDelayTotal', 'deactivationDelay'],
    { section: { details: { isStairwayLs: true } } },
  ),
  bell: control('Pushbutton', 'Sonnette', 'entree', 'security', ['active']),
  sconce: control('Dimmer', 'Applique', 'chambre', 'lights', DIMMER_STATES),
  knx: control('EIBDimmer', 'Plafonnier KNX', 'bureau', 'lights', ['position']),
  lights: control(
    'LightControllerV2',
    'Éclairage salon',
    'salon',
    'lights',
    ['activeMoods', 'moodList', 'favoriteMoods', 'additionalMoods', 'circuitNames', 'presence'],
    {
      uuid: lc,
      section: {
        details: { masterValue: SUB.master.uuid, masterColor: SUB.masterColor.uuid },
        subControls: Object.fromEntries(Object.values(SUB).map((s) => [s.uuid, s.section])),
      },
    },
  ),
  shutter: control(
    'Jalousie',
    'Volet salon',
    'salon',
    'shading',
    [
      'up',
      'down',
      'position',
      'shadePosition',
      'safetyActive',
      'autoAllowed',
      'autoActive',
      'locked',
      'infoText',
      'deviceState',
      'targetPosition',
      'targetPositionLamelle',
    ],
    { section: { details: { isAutomatic: true, animation: 1 } } },
  ),
  curtain: control(
    'Jalousie',
    'Rideau chambre',
    'chambre',
    'shading',
    ['up', 'down', 'position', 'targetPosition'],
    { section: { details: { isAutomatic: false, animation: 2 } } },
  ),
  allShutters: control('CentralJalousie', 'Tous les volets', null, 'shading', [], {
    section: { details: { controls: [{ uuid: 'x', id: 1 }] } },
  }),
  gate: control(
    'Gate',
    'Portail',
    'exterieur',
    'security',
    ['position', 'active', 'preventOpen', 'preventClose'],
    { section: { details: { animation: 3 } } },
  ),
  allGates: control('CentralGate', 'Tous les portails', null, 'security', []),
  velux: control('Window', 'Velux bureau', 'bureau', 'shading', [
    'position',
    'direction',
    'lockedReason',
    'targetPosition',
  ]),
  heating: control(
    'IRoomControllerV2',
    'Chauffage salon',
    'salon',
    'climate',
    [
      'activeMode',
      'operatingMode',
      'overrideEntries',
      'prepareState',
      'overrideReason',
      'tempActual',
      'tempTarget',
      'comfortTemperature',
      'comfortTemperatureCool',
      'absentMinOffset',
      'absentMaxOffset',
      'frostProtectTemperature',
      'heatProtectTemperature',
      'comfortTemperatureOffset',
      'openWindow',
      'capabilities',
    ],
    {
      section: {
        details: {
          format: '%.1f°',
          timerModes: [
            { id: 0, name: 'Éco' },
            { id: 1, name: 'Confort' },
            { id: 2, name: 'Hors-gel' },
          ],
          possibleCapabilities: 3,
        },
      },
    },
  ),
  outside: control('InfoOnlyAnalog', 'Température extérieure', 'exterieur', 'climate', ['value'], {
    section: { details: { format: '%.1f°' } },
  }),
  bathHumidity: control(
    'InfoOnlyAnalog',
    'Humidité salle de bain',
    'chambre',
    'climate',
    ['value'],
    {
      section: { details: { format: '%.0f%%' } },
    },
  ),
  daylight: control('InfoOnlyAnalog', 'Luminosité', 'exterieur', null, ['value'], {
    section: { details: { format: '%.0fLx' } },
  }),
  counter: control('InfoOnlyAnalog', 'Compteur divers', 'garage', null, ['value'], {
    section: { details: { format: '%.0f' } },
  }),
  kitchenWindow: control('InfoOnlyDigital', 'Fenêtre cuisine', 'salon', 'security', ['active'], {
    section: { details: { text: { on: 'Ouvert', off: 'Fermé' } } },
  }),
  hallMotion: control('InfoOnlyDigital', 'Détecteur couloir', 'entree', 'security', ['active'], {
    section: { details: { text: { on: 'Mouvement', off: 'Calme' } } },
  }),
  alarmArmed: control('InfoOnlyDigital', 'Alarme active', 'entree', 'security', ['active'], {
    section: { details: { text: { on: 'Oui', off: 'Non' } } },
  }),
  pump: control('InfoOnlyText', 'Statut pompe', 'garage', null, ['text'], {
    section: { details: { format: '%s' } },
  }),
  house: control(
    'Meter',
    'Consommation maison',
    'garage',
    'energy',
    ['actual', 'total', 'totalDay', 'totalWeek', 'totalMonth', 'totalYear'],
    {
      section: {
        details: { type: 'unidirectional', actualFormat: '%.3fkW', totalFormat: '%.1fkWh' },
      },
    },
  ),
  grid: control('Meter', 'Compteur réseau', 'garage', 'energy', ['actual', 'total', 'totalNeg'], {
    section: {
      details: {
        type: 'bidirectional',
        actualFormat: '%.2fkW',
        totalFormat: '%.1fkWh',
        totalFormatNeg: '%.1fkWh',
      },
    },
  }),
  water: control('Meter', 'Eau', 'garage', 'energy', ['actual', 'total'], {
    section: { details: { actualFormat: '%.1fl/h', totalFormat: '%.3fm³' } },
  }),
  battery: control('Meter', 'Batterie', 'garage', 'energy', ['actual', 'total', 'storage'], {
    section: {
      details: {
        type: 'storage',
        actualFormat: '%.2fkW',
        totalFormat: '%.1fkWh',
        storageFormat: '%.1fkWh',
      },
    },
  }),
  presence: control('PresenceDetector', 'Présence bureau', 'bureau', 'security', [
    'activeSince',
    'active',
    'locked',
    'infoText',
    'time',
  ]),
  safe: control('Switch', 'Coffre', 'bureau', 'security', ['active'], {
    section: { isSecured: true },
  }),
  internal: control('Switch', 'Relais interne', 'garage', null, ['active'], {
    section: { restrictions: 1 },
  }),
  music: control('AudioZoneV2', 'Musique salon', 'salon', null, ['playState', 'volume']),
  alarm: control('Alarm', 'Alarme maison', 'entree', 'security', ['armed', 'level']),
  sprinkler: control('Daytimer', 'Arrosage', 'exterieur', null, ['value']),
  logic: control('', 'Logique', null, null, ['value']),
};

export const LAST_MODIFIED = '2026-10-12 18:31:07';

/** The LoxAPP3.json of the fixture (a fresh copy each time). */
export function structure({ lastModified = LAST_MODIFIED, tempUnit = 0, extra = {} } = {}) {
  const controls = Object.fromEntries(
    Object.values({ ...C, ...extra }).map((c) => [c.uuid, structuredClone(c.section)]),
  );
  return {
    lastModified,
    msInfo: {
      serialNr: SERIAL,
      msName: 'Maison',
      projectName: 'Maison Dupont',
      localUrl: '192.168.1.77:80',
      remoteUrl: '',
      tempUnit,
      currency: '€',
      squareMeasure: 'm²',
      location: 'Lyon',
      languageCode: 'FRA',
      catTitle: 'Catégorie',
      roomTitle: 'Pièce',
    },
    globalStates: {},
    rooms: {
      [ROOMS.salon]: { uuid: ROOMS.salon, name: 'Salon', image: '', defaultRating: 0 },
      [ROOMS.chambre]: { uuid: ROOMS.chambre, name: 'Chambre', image: '', defaultRating: 0 },
      [ROOMS.bureau]: { uuid: ROOMS.bureau, name: 'Bureau', image: '', defaultRating: 0 },
      [ROOMS.entree]: { uuid: ROOMS.entree, name: 'Entrée', image: '', defaultRating: 0 },
      [ROOMS.exterieur]: { uuid: ROOMS.exterieur, name: 'Extérieur', image: '', defaultRating: 0 },
      [ROOMS.garage]: { uuid: ROOMS.garage, name: 'Garage', image: '', defaultRating: 0 },
    },
    cats: {
      [CATS.lights]: { uuid: CATS.lights, name: 'Éclairage', type: 'lights' },
      [CATS.shading]: { uuid: CATS.shading, name: 'Ombrage', type: 'shading' },
      [CATS.climate]: { uuid: CATS.climate, name: 'Climat', type: 'indoortemperature' },
      [CATS.energy]: { uuid: CATS.energy, name: 'Énergie', type: 'undefined' },
      [CATS.security]: { uuid: CATS.security, name: 'Sécurité', type: 'undefined' },
    },
    controls,
  };
}

/** The mood list of the lighting controller (a JSON text state). */
export const MOODS = JSON.stringify([
  { name: 'Lecture', id: 1, favorite: true, used: 0, static: false },
  { name: 'Soirée', id: 2, favorite: true, used: 0, static: false },
  { name: 'Tout allumé', id: 777, favorite: false, used: 0, static: true },
  { name: 'Tout éteint', id: 778, favorite: false, used: 0, static: true },
]);

/** The values the Miniserver sends when the event tables are enabled: state UUID -> value. */
export function initialValues() {
  const v = new Map();
  const set = (c, name, value) => v.set(c.states[name], value);
  set(C.plug, 'active', 1);
  set(C.lamp, 'active', 0);
  set(C.stairs, 'deactivationDelay', 0);
  set(C.bell, 'active', 0);
  set(C.sconce, 'position', 40);
  set(C.knx, 'position', 0);
  set(C.lights, 'activeMoods', '[1]');
  set(C.lights, 'moodList', MOODS);
  set(C.lights, 'favoriteMoods', '[1,2]');
  v.set(SUB.master.states.position, 80);
  v.set(SUB.spots.states.position, 60);
  v.set(SUB.ledStrip.states.color, 'hsv(240,100,50)');
  v.set(SUB.floorLamp.states.active, 1);
  set(C.shutter, 'position', 0.25);
  set(C.shutter, 'up', 0);
  set(C.shutter, 'down', 0);
  set(C.shutter, 'deviceState', 2);
  set(C.curtain, 'position', 1);
  set(C.curtain, 'up', 0);
  set(C.curtain, 'down', 0);
  set(C.gate, 'position', 0);
  set(C.gate, 'active', 0);
  set(C.velux, 'position', 0.3);
  set(C.velux, 'direction', 0);
  set(C.heating, 'tempActual', 20.799999237060547);
  set(C.heating, 'tempTarget', 21);
  set(C.heating, 'operatingMode', 1);
  set(C.heating, 'activeMode', 1);
  set(C.outside, 'value', 12.3);
  set(C.bathHumidity, 'value', 58);
  set(C.daylight, 'value', 15400);
  set(C.counter, 'value', 7);
  set(C.kitchenWindow, 'active', 0);
  set(C.hallMotion, 'active', 0);
  set(C.alarmArmed, 'active', 1);
  set(C.pump, 'text', 'Marche');
  set(C.house, 'actual', 1.234);
  set(C.house, 'total', 4521.6);
  set(C.grid, 'actual', -0.85);
  set(C.grid, 'total', 10234.5);
  set(C.grid, 'totalNeg', 3120.2);
  set(C.water, 'actual', 0);
  set(C.water, 'total', 512.345);
  set(C.presence, 'active', 1);
  set(C.safe, 'active', 0);
  return v;
}
