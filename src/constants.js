// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration) and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};

/** Sensor throttling bounds (seconds), mirrored by the manifest. */
export const SENSOR_INTERVAL = { min: 0, max: 300, default: 10 };

/** Oldest firmware loxone-ts-api supports (it needs the JSON Web Tokens of 11.2). */
export const MIN_FIRMWARE = [11, 2];

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Devices published at once (publishDiscoveredDevices accepts 2,000). */
  devices: 2000,
  /** Options of a select feature (the moods of a lighting controller). */
  options: 100,
  /** Texts sent to Gladys (names, text states). */
  text: 1000,
  /** Control types named by the connection test, most frequent first. */
  typesListed: 8,
};

export const TIMINGS = {
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** The unauthenticated version request made before connecting. */
  probeTimeout: 10_000,
  /** One command or the structure file (the library's own timeout is 15 s). */
  commandTimeout: 15_000,
  /** Killing the token when closing: then the socket is closed anyway. */
  closeTimeout: 5000,
  /** LoxAPPversion3 is asked this often: the structure changed in Loxone Config. */
  structureCheck: 10 * 60_000,
  /** A mood list changed: wait for the burst of events to end before re-publishing. */
  republishDebounce: 3000,
  /** Reconnection delays after a failure (doubled each time, up to the max). */
  retryMin: 5000,
  retryMax: 60_000,
  /**
   * Refused credentials are retried slowly: the user has to change them, and
   * the Miniserver blocks an address after repeated failed logins.
   */
  authRetry: 5 * 60_000,
};
