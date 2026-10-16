import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { StatePublisher } from '../src/publisher.js';

const F = (key) => `ext:test-integration:loxone:dev:${key}`;

async function setup({ budget } = {}) {
  const gladys = createFakeGladys();
  await gladys.connect();
  let now = 1_760_000_000_000;
  const publisher = new StatePublisher({
    gladys,
    logger: createLogger({ level: 'silent' }),
    now: () => now,
    budget,
  });
  return { gladys, publisher, advance: (ms) => (now += ms) };
}

test('the last value of each feature, numbers and texts, unchanged ones skipped', async () => {
  const { gladys, publisher } = await setup();
  publisher.push(F('binary'), 0);
  publisher.push(F('binary'), 1);
  publisher.push(F('text'), 'Marche');
  assert.equal(await publisher.flush(), 2);
  assert.equal(gladys.fake.lastState(F('binary')), 1);
  assert.deepEqual(
    gladys.fake.states.map((s) => s.text ?? s.state),
    [1, 'Marche'],
  );
  publisher.push(F('binary'), 1);
  assert.equal(await publisher.flush(), 0, 'unchanged');
});

test('events are sent in order, never merged; measurements spaced by the interval', async () => {
  const { gladys, publisher, advance } = await setup();
  publisher.configure({ intervalSeconds: 10, throttled: new Set([F('power')]) });
  publisher.pushEvent(F('button'), 1);
  publisher.pushEvent(F('button'), 0);
  publisher.push(F('power'), 5);
  await publisher.flush();
  assert.deepEqual(
    gladys.fake.states.map((s) => [s.device_feature_external_id, s.state]),
    [
      [F('button'), 1],
      [F('button'), 0],
      [F('power'), 5],
    ],
  );
  publisher.push(F('power'), 6);
  await publisher.flush();
  assert.equal(gladys.fake.lastState(F('power')), 5, 'too early');
  advance(10_000);
  await publisher.flush();
  assert.equal(gladys.fake.lastState(F('power')), 6);
});

test('the per-minute budget, a failed request kept for the next round, forget()', async (t) => {
  const { gladys, publisher, advance } = await setup({ budget: 2 });
  publisher.push(F('a'), 1);
  publisher.push(F('b'), 1);
  publisher.push(F('c'), 1);
  assert.equal(await publisher.flush(), 2);
  assert.equal(await publisher.flush(), 0, 'budget spent');
  advance(60_000);
  t.mock.method(gladys, 'publishChangedStates', async () => {
    throw new Error('429');
  });
  await assert.rejects(publisher.flush(), /429/);
  assert.equal(publisher.pending.get(F('c')), 1, 'kept');
  publisher.forget('ext:test-integration:loxone:dev');
  assert.equal(publisher.pending.size, 0);
});
