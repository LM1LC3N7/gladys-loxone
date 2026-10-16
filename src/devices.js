// -----------------------------------------------------------------------------
// The controls of the structure file -> Gladys devices and routing tables
// (pure).
//
// External ids:
//   device  ext:<selector>:loxone:<control UUID>   ("/" of a subcontrol -> "-")
//   feature <device>:<key>   (src/mapping.js: binary, brightness, position…)
// Loxone Config gives every block a UUID kept across renames and moves (and
// a backup restored on a new Miniserver keeps them): the ids stay stable.
// -----------------------------------------------------------------------------

import { LIMITS } from './constants.js';
import { isSupported, mapControl } from './mapping.js';

/** The platform id of a control: its UUID, "/" of a light circuit turned into "-". */
export const platformId = (uuid) =>
  String(uuid)
    .replace(/[^0-9a-z-]/gi, '-')
    .toLowerCase();

/** Block names repeat from room to room ("Light"): the room is part of the name. */
export const deviceName = (name, room) => (room ? `${name} (${room})` : name).slice(0, 100);

const paramsOf = (control) =>
  [
    { name: 'LOXONE_UUID', value: control.uuid },
    { name: 'LOXONE_TYPE', value: control.type },
    { name: 'LOXONE_ROOM', value: control.roomName },
    { name: 'LOXONE_CATEGORY', value: control.catName },
  ].filter((p) => p.value);

export function emptyModel() {
  return {
    devices: [],
    /** state UUID -> [{ featureId, deps, read, event }] */
    readers: new Map(),
    /** feature id -> { name, write } */
    writers: new Map(),
    throttled: new Set(),
    optimistic: new Set(),
    /** state UUIDs whose change re-publishes the devices */
    watch: new Set(),
    /** device id -> { deps, read } (true: the Loxone device is offline) */
    health: new Map(),
    /** state UUID -> device ids whose health depends on it */
    healthDeps: new Map(),
    deviceIds: [],
    counts: { controls: 0, empty: 0, overflow: 0, unsupported: new Map(), readOnly: 0 },
  };
}

const pushTo = (map, key, value) => {
  if (!map.has(key)) {
    map.set(key, []);
  }
  map.get(key).push(value);
};

/**
 * @param {(platformId: string) => { device: string, feature: (key: string) => string }} idsOf
 *   the external ids of one device (gladys.externalIds('loxone', id))
 * @param {{ controls: object[] }} inventory see src/structure.js
 * @param {{ unit?: 'C' | 'F', get?: (uuid: string) => unknown }} [context]
 */
export function buildModel(idsOf, inventory, { unit = 'C', get } = {}) {
  const model = emptyModel();
  for (const control of inventory.controls) {
    model.counts.controls += 1;
    if (!isSupported(control.type)) {
      model.counts.unsupported.set(
        control.type,
        (model.counts.unsupported.get(control.type) ?? 0) + 1,
      );
      continue;
    }
    const mapped = mapControl(control, { unit, get });
    if (mapped.length === 0) {
      model.counts.empty += 1;
      continue;
    }
    if (control.readOnly) {
      model.counts.readOnly += 1;
    }
    for (const entry of mapped) {
      if (model.devices.length >= LIMITS.devices) {
        model.counts.overflow += 1;
        continue;
      }
      const ids = idsOf(platformId(entry.uuid));
      model.deviceIds.push(ids.device);
      model.devices.push({
        name: deviceName(entry.name, entry.control.roomName),
        external_id: ids.device,
        should_poll: false,
        params: paramsOf(entry.control),
        features: entry.features.map(({ key, ...feature }) => ({
          ...feature,
          external_id: ids.feature(key),
        })),
      });
      for (const { key, deps, read, event } of entry.readers) {
        const reader = { featureId: ids.feature(key), deps, read, event };
        for (const dep of new Set(deps)) {
          pushTo(model.readers, dep, reader);
        }
      }
      for (const [key, write] of Object.entries(entry.writers)) {
        model.writers.set(ids.feature(key), { name: entry.name, write });
      }
      for (const key of entry.throttled) {
        model.throttled.add(ids.feature(key));
      }
      for (const key of entry.optimistic) {
        model.optimistic.add(ids.feature(key));
      }
      for (const uuid of entry.watch) {
        model.watch.add(uuid);
      }
      if (entry.health) {
        model.health.set(ids.device, entry.health);
        for (const dep of entry.health.deps) {
          pushTo(model.healthDeps, dep, ids.device);
        }
      }
    }
  }
  return model;
}

/** The unsupported control types, most frequent first: [[type, count]]. */
export const unsupportedTypes = (model) =>
  [...model.counts.unsupported].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
