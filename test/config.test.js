import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, parseAddress } from '../src/config.js';

test('the address of the Miniserver, as users type it', () => {
  assert.deepEqual(parseAddress('192.168.1.77'), { origin: 'http://192.168.1.77' });
  assert.deepEqual(parseAddress(' 192.168.1.77:8080 '), { origin: 'http://192.168.1.77:8080' });
  assert.deepEqual(parseAddress('http://miniserver.lan/'), { origin: 'http://miniserver.lan' });
  assert.deepEqual(parseAddress('https://192-168-1-77.504f94a0b1c2.dyndns.loxonecloud.com'), {
    origin: 'https://192-168-1-77.504f94a0b1c2.dyndns.loxonecloud.com',
  });
  assert.deepEqual(parseAddress('http://192.168.1.77/#/home'), { origin: 'http://192.168.1.77' });
  assert.deepEqual(parseAddress(''), { error: 'empty' });
  assert.deepEqual(parseAddress('ftp://192.168.1.77'), { error: 'invalid' });
  assert.deepEqual(parseAddress('http://admin:pw@192.168.1.77'), { error: 'credentials' });
  // A serial number means Remote Connect, through the Loxone cloud: not in this version.
  assert.deepEqual(parseAddress('504F94A0B1C2'), { error: 'serial' });
  assert.deepEqual(parseAddress('50:4F:94:A0:B1:C2'), { error: 'serial' });
});

test('normalizeConfig: defaults, errors in order, bounded interval', () => {
  assert.equal(normalizeConfig().error, 'empty');
  assert.equal(normalizeConfig({ host: '192.168.1.77' }).error, 'no-user');
  assert.equal(
    normalizeConfig({ host: '192.168.1.77', username: ' gladys ' }).error,
    'no-password',
  );
  const c = normalizeConfig({
    host: '192.168.1.77',
    username: ' gladys ',
    password: ' p ',
    sensor_interval: '900',
  });
  assert.equal(c.error, undefined);
  assert.equal(c.username, 'gladys');
  assert.equal(c.password, ' p ', 'a password is kept as typed');
  assert.equal(c.sensorInterval, 300);
  assert.equal(normalizeConfig({ sensor_interval: null }).sensorInterval, DEFAULTS.sensor_interval);
});
