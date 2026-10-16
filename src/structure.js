// -----------------------------------------------------------------------------
// The structure file of the Miniserver (LoxAPP3.json) -> the controls to map
// (pure).
//
// Loxone's "Structure File" document: `msInfo` (serial number, names, unit),
// `rooms` and `cats` keyed by UUID, `controls` keyed by their uuidAction, each
// with a `type`, a `room`, a `cat`, its `states` (state name -> state UUID,
// the UUIDs of the value and text events), `details`, optional `subControls`
// (light circuits of a lighting controller…) and a `restrictions` bitmap.
// -----------------------------------------------------------------------------

/** UUIDs are compared in lower case (the library prints them so). */
export const uuidKey = (raw) =>
  String(raw ?? '')
    .trim()
    .toLowerCase();

/** restrictions bit 0: only shown inside a system scheme; bit 1: read only. */
const REFERENCED_ONLY = 1;
const READ_ONLY = 2;

const text = (raw) => (typeof raw === 'string' ? raw.trim() : '');

function statesOf(section) {
  const states = {};
  for (const [name, uuid] of Object.entries(section?.states ?? {})) {
    // A state is a UUID, or (rarely) a list of them: only the single ones are events.
    if (typeof uuid === 'string' && uuid) {
      states[name] = uuidKey(uuid);
    }
  }
  return states;
}

function controlOf(uuid, section, base) {
  return {
    uuid: uuidKey(uuid),
    // Commands go to the UUID as written ("…/masterValue"), the lookups use lower case.
    uuidAction: text(section.uuidAction) || String(uuid).trim(),
    name: text(section.name) || base.fallbackName || section.type,
    type: text(section.type),
    states: statesOf(section),
    details: section.details && typeof section.details === 'object' ? section.details : {},
    ...base.extra,
  };
}

/**
 * @param {object} raw the parsed LoxAPP3.json
 * @returns {{
 *   lastModified: string,
 *   ms: { serial: string, name: string, project: string, unit: 'C' | 'F' },
 *   controls: object[],
 *   skipped: { hidden: number, untyped: number },
 * }}
 */
export function readStructure(raw) {
  const ms = raw?.msInfo ?? {};
  const rooms = new Map(
    Object.entries(raw?.rooms ?? {}).map(([uuid, room]) => [uuidKey(uuid), text(room?.name)]),
  );
  const cats = new Map(
    Object.entries(raw?.cats ?? {}).map(([uuid, cat]) => [
      uuidKey(uuid),
      { name: text(cat?.name), type: text(cat?.type) },
    ]),
  );
  const controls = [];
  const skipped = { hidden: 0, untyped: 0 };
  for (const [uuid, section] of Object.entries(raw?.controls ?? {})) {
    if (!section || typeof section !== 'object') {
      continue;
    }
    const type = text(section.type);
    // An empty type is a control that must not be visualized.
    if (type === '' || type === 'SystemScheme') {
      skipped.untyped += 1;
      continue;
    }
    const restrictions = Number(section.restrictions) || 0;
    if (restrictions & REFERENCED_ONLY) {
      skipped.hidden += 1;
      continue;
    }
    const roomName = rooms.get(uuidKey(section.room)) ?? '';
    const cat = cats.get(uuidKey(section.cat)) ?? { name: '', type: '' };
    const control = controlOf(uuid, section, {
      extra: {
        roomName,
        catName: cat.name,
        catType: cat.type,
        // A secured control needs the visualisation password for every command.
        readOnly: Boolean(restrictions & READ_ONLY) || section.isSecured === true,
        secured: section.isSecured === true,
      },
    });
    control.subControls = Object.entries(section.subControls ?? {})
      .filter(([, sub]) => sub && typeof sub === 'object')
      .map(([subUuid, sub]) =>
        controlOf(subUuid, sub, {
          fallbackName: control.name,
          extra: { roomName, catName: cat.name, catType: cat.type, readOnly: control.readOnly },
        }),
      );
    controls.push(control);
  }
  controls.sort(
    (a, b) => a.roomName.localeCompare(b.roomName) || a.name.localeCompare(b.name) || 0,
  );
  return {
    lastModified: text(raw?.lastModified),
    ms: {
      serial: text(ms.serialNr),
      name: text(ms.msName),
      project: text(ms.projectName),
      unit: Number(ms.tempUnit) === 1 ? 'F' : 'C',
    },
    controls,
    skipped,
  };
}
