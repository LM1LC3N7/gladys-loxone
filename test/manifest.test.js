// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULTS } from '../src/config.js';
import { ACTIONS, SENSOR_INTERVAL } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-loxone:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/LM1LC3N7/gladys-loxone/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
});

test('unofficial, and said so', () => {
  const intro = manifest.config_schema.find((f) => f.key === 'intro');
  assert.match(intro.description.en, /Unofficial, not affiliated with Loxone\./);
  assert.match(intro.description.fr, /Non officiel, sans lien avec Loxone\./);
  assert.match(read('README.md'), /not affiliated with Loxone/);
  assert.match(pkg.description, /not affiliated with Loxone/);
});

test('the configuration matches the code', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULTS)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    if (fields[key].default !== undefined || !['', null].includes(value)) {
      assert.deepEqual(fields[key].default, value, key);
    }
  }
  assert.deepEqual(
    manifest.config_schema.map((f) => f.key).filter((k) => k !== 'intro'),
    Object.keys(DEFAULTS),
  );
  assert.equal(fields.password.type, 'secret');
  for (const key of ['host', 'username', 'password']) {
    assert.equal(fields[key].required, true, key);
  }
  assert.deepEqual(
    [fields.sensor_interval.min, fields.sensor_interval.max],
    [SENSOR_INTERVAL.min, SENSOR_INTERVAL.max],
  );
  const intro = fields.intro;
  assert.equal(intro.type, 'section');
  for (const lang of ['en', 'fr']) {
    assert.ok(intro.description[lang].length <= 1000, `intro.${lang} over 1000 characters`);
  }
  assert.ok(intro.links.length <= 5 && intro.links.every((l) => l.url.startsWith('https://')));
  for (const field of manifest.config_schema.filter((f) => f.placeholder !== undefined)) {
    assert.equal(
      typeof field.placeholder,
      'object',
      `${field.key}: placeholder must be multi-language`,
    );
  }
});

test('the keys of the manifest are the keys of the code', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds >= 5 && action.timeout_seconds <= 120);
  }
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.scene_actions, undefined);
});
