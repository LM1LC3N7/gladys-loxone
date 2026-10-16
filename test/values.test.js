import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hsvToInt,
  intToHueSat,
  parseColor,
  parseJson,
  round,
  toNumber,
  unitOfFormat,
} from '../src/values.js';

test('the unit of a C format', () => {
  assert.equal(unitOfFormat('%.1f°'), '°');
  assert.equal(unitOfFormat('%.1f°C'), '°C');
  assert.equal(unitOfFormat('%.0f%%'), '%');
  assert.equal(unitOfFormat('%.3f kWh'), 'kWh');
  assert.equal(unitOfFormat('%.0fLx'), 'Lx');
  assert.equal(unitOfFormat('%d'), '');
  assert.equal(unitOfFormat('<v.1> °C'), '°C');
  assert.equal(unitOfFormat(undefined), '');
});

test('colors: hsv and temp texts, Gladys RGB integers', () => {
  assert.deepEqual(parseColor('hsv(240,100,50)'), { h: 240, s: 100, v: 50 });
  assert.deepEqual(parseColor('HSV( 10 , 20 , 30 )'), { h: 10, s: 20, v: 30 });
  assert.deepEqual(parseColor('temp(80,2700)'), { brightness: 80, kelvin: 2700 });
  assert.equal(parseColor('rgb(1,2,3)'), undefined);
  assert.equal(hsvToInt({ h: 0, s: 100 }), 0xff0000);
  assert.equal(hsvToInt({ h: 120, s: 100 }), 0x00ff00);
  assert.equal(hsvToInt({ h: 240, s: 100 }), 0x0000ff);
  assert.equal(hsvToInt({ h: 0, s: 0 }), 0xffffff);
  assert.deepEqual(intToHueSat(0xff0000), { h: 0, s: 100 });
  assert.deepEqual(intToHueSat(0x0000ff), { h: 240, s: 100 });
  assert.deepEqual(intToHueSat(0xff00ff), { h: 300, s: 100 });
  assert.deepEqual(intToHueSat(0xffffff), { h: 0, s: 0 });
});

test('numbers and JSON texts', () => {
  assert.equal(toNumber('21.5'), 21.5);
  assert.equal(toNumber(''), undefined);
  assert.equal(toNumber(true), undefined);
  assert.equal(toNumber('x'), undefined);
  assert.equal(round(20.799999237060547, 2), 20.8);
  assert.deepEqual(parseJson('[1,2]'), [1, 2]);
  assert.equal(parseJson('[1,'), undefined);
  assert.equal(parseJson(''), undefined);
});
