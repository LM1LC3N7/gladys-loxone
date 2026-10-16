import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildModel, deviceName, platformId, unsupportedTypes } from '../src/devices.js';
import { readStructure } from '../src/structure.js';
import { C, SUB, initialValues, structure } from './fixtures/loxone.js';

const gladys = createFakeGladys();
const idsOf = (id) => gladys.externalIds('loxone', id);
const inventory = readStructure(structure());
const values = initialValues();
const model = buildModel(idsOf, inventory, { get: (uuid) => values.get(uuid) });
const byName = (name) => model.devices.find((d) => d.name === name);

test('one Gladys device per block (and per light circuit), named after its room', () => {
  assert.equal(model.devices.length, 30);
  assert.equal(model.counts.controls, 31);
  assert.equal(model.counts.empty, 1, 'the storage meter');
  assert.equal(model.counts.readOnly, 1, 'the secured switch');
  assert.deepEqual(unsupportedTypes(model), [
    ['Alarm', 1],
    ['AudioZoneV2', 1],
    ['Daytimer', 1],
  ]);
  const plug = byName('Prise TV (Salon)');
  assert.equal(plug.external_id, `ext:test-integration:loxone:${C.plug.uuid}`);
  assert.equal(plug.should_poll, false);
  assert.deepEqual(plug.params, [
    { name: 'LOXONE_UUID', value: C.plug.uuid },
    { name: 'LOXONE_TYPE', value: 'Switch' },
    { name: 'LOXONE_ROOM', value: 'Salon' },
    { name: 'LOXONE_CATEGORY', value: 'Énergie' },
  ]);
  assert.equal(plug.features[0].external_id, `${plug.external_id}:binary`);
  const strip = byName('Ruban LED (Salon)');
  assert.equal(strip.external_id, `ext:test-integration:loxone:${platformId(SUB.ledStrip.uuid)}`);
  assert.match(strip.external_id, /-ai2$/, 'the "/" of a circuit becomes "-"');
  assert.equal(deviceName('x'.repeat(120), 'Salon').length, 100);
  assert.equal(deviceName('Tous les volets', ''), 'Tous les volets');
});

test('the routing tables: readers by state UUID, writers, throttled, watched, health', () => {
  const plugFeature = `ext:test-integration:loxone:${C.plug.uuid}:binary`;
  assert.deepEqual(
    model.readers.get(C.plug.states.active).map((r) => r.featureId),
    [plugFeature],
  );
  // A circuit's dimmer and the master brightness read different states.
  assert.equal(model.readers.get(SUB.master.states.position).length, 1);
  assert.ok(model.writers.has(plugFeature));
  assert.ok(!model.writers.has(`ext:test-integration:loxone:${C.safe.uuid}:binary`));
  assert.ok(model.throttled.has(`ext:test-integration:loxone:${C.house.uuid}:power`));
  assert.ok(model.watch.has(C.lights.states.moodList));
  const shutterId = `ext:test-integration:loxone:${C.shutter.uuid}`;
  assert.ok(model.health.has(shutterId));
  assert.deepEqual(model.healthDeps.get(C.shutter.states.deviceState), [shutterId]);
  assert.equal(new Set(model.deviceIds).size, model.devices.length, 'the ids are unique');
});

test('the SDK fake accepts every device (categories, types, units)', async () => {
  const fake = createFakeGladys();
  await fake.connect();
  await fake.publishDiscoveredDevices(
    buildModel((id) => fake.externalIds('loxone', id), inventory, {
      get: (uuid) => values.get(uuid),
    }).devices,
  );
  assert.equal(fake.fake.discoveredDevices.length, 30);
});
