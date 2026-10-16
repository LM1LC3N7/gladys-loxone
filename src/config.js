// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { SENSOR_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  host: '',
  username: '',
  password: '',
  sensor_interval: SENSOR_INTERVAL.default,
};

/** A Miniserver serial number (its MAC address): the Remote Connect form of loxone-ts-api. */
const SERIAL = /^(?:[0-9a-f]{2}[:-]?){5}[0-9a-f]{2}$/i;

/**
 * The origin of the Miniserver from what the user typed: "192.168.1.77",
 * "miniserver.lan:8080", "http://192.168.1.77/" or "https://…" (Gen 2).
 * @returns {{ origin: string } | { error: 'empty' | 'invalid' | 'credentials' | 'serial' }}
 */
export function parseAddress(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { error: 'empty' };
  }
  if (SERIAL.test(text)) {
    // Remote Connect goes through the Loxone cloud: not in this version.
    return { error: 'serial' };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    // The password has its own (secret) field: never in an address that gets logged.
    return { error: 'credentials' };
  }
  return { origin: url.origin };
}

const bounded = (raw, { min, max, default: fallback }) => {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
  const c = { ...DEFAULTS, ...given };
  const target = parseAddress(c.host);
  const username = String(c.username ?? '').trim();
  const password = String(c.password ?? '');
  let error = target.error;
  if (!error && username === '') {
    error = 'no-user';
  } else if (!error && password === '') {
    error = 'no-password';
  }
  return {
    origin: target.origin,
    error,
    username,
    password,
    sensorInterval: Math.round(bounded(c.sensor_interval, SENSOR_INTERVAL)),
  };
}
