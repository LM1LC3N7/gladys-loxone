import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStructure, uuidKey } from '../src/structure.js';
import { C, LAST_MODIFIED, SERIAL, SUB, structure } from './fixtures/loxone.js';

test('the structure file: Miniserver, controls with their room and category', () => {
  const s = readStructure(structure());
  assert.equal(s.lastModified, LAST_MODIFIED);
  assert.deepEqual(s.ms, { serial: SERIAL, name: 'Maison', project: 'Maison Dupont', unit: 'C' });
  assert.equal(s.controls.length, 31);
  assert.deepEqual(s.skipped, { hidden: 1, untyped: 1 });
  const plug = s.controls.find((c) => c.uuid === C.plug.uuid);
  assert.equal(plug.roomName, 'Salon');
  assert.equal(plug.catName, 'Énergie');
  assert.equal(plug.readOnly, false);
  assert.equal(plug.states.active, C.plug.states.active);
  const lamp = s.controls.find((c) => c.uuid === C.lamp.uuid);
  assert.equal(lamp.catType, 'lights');
  const all = s.controls.find((c) => c.uuid === C.allShutters.uuid);
  assert.equal(all.roomName, '', 'a control without a room');
});

test('secured and read-only controls, subcontrols, the order of the list', () => {
  const raw = structure();
  raw.controls[C.lamp.uuid].restrictions = 2;
  const s = readStructure(raw);
  const safe = s.controls.find((c) => c.uuid === C.safe.uuid);
  assert.equal(safe.readOnly, true);
  assert.equal(safe.secured, true);
  assert.equal(s.controls.find((c) => c.uuid === C.lamp.uuid).readOnly, true);
  const lights = s.controls.find((c) => c.uuid === C.lights.uuid);
  assert.deepEqual(
    lights.subControls.map((x) => x.uuid),
    Object.values(SUB).map((x) => uuidKey(x.uuid)),
  );
  assert.equal(lights.subControls[0].uuidAction, SUB.master.uuid, 'commands keep the case');
  assert.equal(
    lights.subControls[0].roomName,
    'Salon',
    'a circuit is in the room of its controller',
  );
  const rooms = s.controls.map((c) => c.roomName);
  assert.deepEqual(
    rooms,
    [...rooms].sort((a, b) => a.localeCompare(b)),
  );
});

test('Fahrenheit, odd sections and upper-case UUIDs', () => {
  const raw = structure({ tempUnit: 1 });
  raw.controls.broken = null;
  const upper = raw.controls[C.plug.uuid];
  upper.states = { active: C.plug.states.active.toUpperCase(), list: ['a', 'b'] };
  const s = readStructure(raw);
  assert.equal(s.ms.unit, 'F');
  const plug = s.controls.find((c) => c.uuid === C.plug.uuid);
  assert.deepEqual(plug.states, { active: C.plug.states.active });
  assert.deepEqual(readStructure(undefined).controls, []);
});
