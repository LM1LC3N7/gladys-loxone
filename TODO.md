# TODO — Loxone Miniserver v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the main session posts one recap message in /t/10385 (claim: post #224). A
  module report ends with "Récap forum : <module> — <one French sentence>".

## Status

- [x] **Milestone 1 — core** (2026-10-16): probe (`jdev/cfg/apiKey`, firmware
      ≥ 11.2), token login through loxone-ts-api (Gen 1 command encryption,
      Gen 2, refresh, token reused at the reconnection), structure file
      (rooms, categories, restrictions, secured blocks, subcontrols), mapping
      of 19 control types (Switch, TimedSwitch, Pushbutton, Dimmer, EIBDimmer,
      ColorPickerV2, LightControllerV2 with moods / master brightness /
      circuits, Jalousie, CentralJalousie, Gate, CentralGate, Window,
      CentralWindow, IRoomControllerV2, InfoOnlyAnalog, InfoOnlyDigital,
      InfoOnlyText, Meter, PresenceDetector), live states from the event
      tables (changes only, measurements throttled, push button presses in
      order), commands, structure re-read (LoxAPPversion3 every 10 min, Scan,
      reconnection), mood lists re-published, transport badges (unreachable,
      offline Air/Tree motor degraded), connection test, reconnection with
      backoff and slow retry of refused logins, manifest, docs en/fr. Tests on
      a structure file written after Loxone's documents with the library
      mocked at its boundary, plus the real library classes for the event
      decoding, the message guard and the log lines; an end-to-end run of the
      production image (read-only, 256 MB, 0.5 CPU: RSS 91 MB) with the real
      library over a real socket against a simulated Gen 1 Miniserver written
      from Loxone's documents (RSA key exchange, AES command encryption,
      getkey2 / getjwt, binary event tables, commands, token reuse at the
      reconnection, killtoken): 16 checks green
      (`~/gladys-integrations/e2e/loxone-e2e.sh`, outside the repository).
      **Not run against a real Miniserver** (none available).
- [ ] **Milestone 2 — real Miniservers**: collect a LoxAPP3.json (Gen 1 and
      Gen 2, anonymized), the event values of a few blocks and the logs of a
      login from testers; fix what differs. See "To check on a real
      Miniserver".
- [ ] **Milestone 3 — more blocks and access**: the types below, Remote
      Connect and CloudDNS (cloud transport with the "prefer local" toggle of
      Gladys, `msInfo.localUrl` as the local path), UDP discovery through
      `gladys.scanNetwork` (`network_discovery`, port 7070), secured blocks
      (visualisation password hash: `jdev/sps/ios/<hash>/<uuid>/<cmd>`), the
      slats of blinds (`shadePosition`, `manualLamelle`), the humidity and CO2
      of a room controller (15.1), tunable white temperature of a color
      picker, the master color of a lighting controller, storage meters,
      flows of water meters, a scene trigger for push buttons and a "Send a
      Loxone command" scene action.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic (the forum recap is the main session's, see Working method).

## Not supported yet (listed by the connection test)

Alarm, AalSmartAlarm, AalEmergency, AlarmChain, AlarmClock, Application,
AudioZone, AudioZoneV2, CarCharger, CentralAlarm, CentralAudioZone,
CentralLightController, ClimateController, ClimateControllerUS, ColorPicker
(v1), Daytimer and its variants, EnergyManager, EnergyManager2,
EnergyFlowMonitor, Fronius, Heatmixer, Hourcounter, Intelligent Room
Controller v1 (IRoomController), Intercom, IntercomV2, Irrigation, NFC Code
Touch, LightController (v1), LightsceneRGB, LoadManager, MailBox, MsShortcut,
PoolController, Radio, PulseAt, Remote, Sauna, Sequential, Slider, SmokeAlarm,
SolarPumpController, SpotPriceOptimizer, StatusMonitor, SteakThermo,
TextState, TextInput, Tracker, UpDownLeftRight, ValueSelector, Ventilation,
Webpage, WindowMonitor, PowerUnit, Wallbox2, WallboxManager, ACControl.

## To check on a real Miniserver

- Login: the log line of a refused password (`Failed to acquire JWT: 401`),
  an unknown user (`getkey2`), a disabled user (423), the 4003 close after
  failed logins, the "no event slot" case; the lifetime of the web-permission
  token the library asks for, and the reuse of a token after a network cut.
- Gen 2: plain `http://` login and commands (the library sends the commands
  unencrypted when `httpsStatus` is set), an `https://` CloudDNS address, the
  firmware strings in `jdev/cfg/apiKey`.
- Structure: real `restrictions` values, `isSecured` blocks, the subcontrol
  UUIDs of a LightControllerV2 (`<uuid>/AI1`, `/masterValue`), whether the
  Miniserver accepts the commands to a lower-case UUID (the original case is
  kept, to be safe), `details.format` strings of virtual states in several
  languages, meter formats (`actualFormat`, `totalFormatNeg`, storage).
- Event tables: the size and duration of the first burst on a large
  installation (several thousand states), the text events of `activeMoods`,
  `moodList`, `color` (`hsv(…)`, `temp(…)`), `jdev/sps/LoxAPPversion3`
  answers, the reconnection after a program upload (out-of-service header,
  close code).
- Commands: `override/3//<temp>` and `override/<mode>` without an end date,
  `stopOverride`, `setOperatingMode/<n>` on heat-only rooms, `changeTo/777`
  when no "all on" mood exists, `manualPosition` vs the end positions, a gate
  `open` / `close`, `moveToPosition` of a window, `pulse` of a virtual push
  button, the answer of a command to a locked block (`jLocked`).
- Polarity of digital virtual states used as window contacts (texts other
  than open / closed), and the units of analog states without a format.

## Decisions

- **loxone-ts-api as the client, used as is** (Louis's rule: reuse
  maintained community work). Checked on 2026-10-16: 2.1.1 of 2026-09-27
  (2.0 in July 2026, 1.x since 2025-09), MIT, one maintainer (andrasg) who
  also builds matterbridge-loxone on it, 5 issues all closed (WSS/HTTPS
  support asked by the homebridge-loxone-proxy author, unique client UUID,
  command errors), dependencies `ws` and `node-ansi-logger` only (1.3 MB
  installed), `npm audit` clean, engines Node 24 or 26 (so this repository
  requires Node 24 and the CI runs 24 and 26). It does token login with
  refresh for Gen 1 (command encryption) and Gen 2, the WebSocket protocol,
  the value and text event tables, commands, and Remote Connect. Its rough
  edges are handled in `src/loxone.js` without patching it:
  - `connect()` never rejects: it ends in an "error" state and logs the
    reason. The states it went through and its last error line (routed from
    node-ansi-logger's global callback) give the failure kind.
  - Its own reconnection reuses the same socket object, whose decoder state
    is not reset: turned off (`autoReconnectEnabled: false`); the app
    reconnects with a fresh client and reads the structure again.
  - It calls `process.exit(1)` on a firmware older than 11: the firmware is
    checked by our own `jdev/cfg/apiKey` probe first (≥ 11.2, as its README
    says).
  - Its message handler throws inside the socket listener on an unexpected
    frame (that would crash the process): the handler of the instance is
    wrapped (feature-detected, nothing if the internals change) to close the
    connection instead; the app reconnects.
  - Its logs (colored, on the console) are silenced (`logLevel: NONE`) and
    sent to the integration logger at debug level, ANSI codes removed.
  - It keeps a copy of the structure file: dropped after reading
    (`maintainLatestEvents: false`, `structureFile = undefined`), our model
    keeps only what it maps.
    To report upstream (not blocking): the version check (`versionParts[0] ===
11` compares a string to a number, `exit(1)`), the decoder state not reset
    at reconnection, the throwing message handler, `connect()` resolving on
    failure.
- **No duplicate** (checked 2026-10-16): no Loxone service in the Gladys core
  (`server/services` on master: 39 services; the `matterbridge` one installs
  a generic Matterbridge container, where a user could add the
  matterbridge-loxone plugin and pair it through Matter: an indirect route,
  UUIDs typed by hand, Matter device types only, no moods, presets or
  meters), none in the store (GitHub topic search `topic:gladys-assistant-integration
loxone`: 0), none on GitHub (only this repository) nor on the forum (only
  the claim in /t/10385 #224). Tracker n° 484.
- One Gladys device per block, and one per light circuit of a lighting
  controller (its master brightness and moods stay on the controller
  device); named `<block> (<room>)`; params `LOXONE_UUID`, `LOXONE_TYPE`,
  `LOXONE_ROOM`, `LOXONE_CATEGORY`. External ids from the UUID of the block,
  `/` of a circuit turned into `-`, lower case: Loxone Config keeps the UUIDs
  across renames and moves.
- Commands go to the UUID as the structure file writes it; lookups are in
  lower case (the library prints the event UUIDs in lower case).
- Hidden blocks (restrictions bit 0) are left out; read-only (bit 1) and
  secured blocks (`isSecured`: every command needs the visualisation
  password) are offered read-only.
- A Switch is a light in a category of type `lights` and in a lighting
  controller, a switch otherwise. Dimmers are lights.
- Push buttons: one `binary` feature, on → `pulse`; the `active` changes go
  through `publishStates` in order (1 then 0 within a second), consecutive
  equal values skipped.
- LightControllerV2: moods as a `text` / `select` feature (values = mood ids,
  "off" 778 first with the Miniserver's name for it), `changeTo/<id>`; on/off
  from `activeMoods` (off = only 778), on → 777 when it exists, else the
  first favorite mood; master brightness from `details.masterValue`. The
  devices are re-published 3 s after a `moodList` change (Gladys upserts the
  options of a created device).
- Covers: Gladys position 100 = open. Jalousie position 0 = up (open), so
  Gladys = (1 − p) × 100, written `manualPosition/<100 − v>`, the ends as
  `FullUp` / `FullDown` (as matterbridge-loxone); state from `up` / `down`;
  curtains for the animations 2, 4, 5. Gate and Window positions 1 = open
  (the gate position read-only: it has no position command). Central objects:
  open / close / stop only, optimistic.
- IRoomControllerV2: setpoint written `override/3//<temp>` (a manual override
  without end, as ioBroker.loxone), mode from `operatingMode` (−1 off, 0/3
  auto, 1/4 heat, 2/5 cool), written within the same automatic / manual
  family, off refused; preset from `activeMode` (0 eco → ECO, 1 comfort →
  COMFORT, 2 building protection → FROST; manual and off: no preset),
  written `override/<id>`, SCHEDULE = `stopOverride`; temperatures in the
  unit of `msInfo.tempUnit`, setpoint 5–35 °C / 40–95 °F, step 0.5.
- InfoOnlyAnalog: kind and unit from the C format (`%.1f°`, `%.0f%%`,
  `%.3fkWh`…; `°` alone takes the unit of the Miniserver); `%` is humidity or
  battery by the name, else an unknown-category value; no unit: an
  unknown-category value. InfoOnlyDigital: an opening sensor when its on/off
  texts say open / closed (both polarities, en/de/fr/it/es/cs), a motion
  sensor by its texts or name, else an `input`.
- Meter: unidirectional → energy-sensor power + index; bidirectional →
  grid-sensor power (signed), input and output indexes; volumes (m³, l) as
  volume sensors; storage meters and flows left for later.
- Remote Connect (a serial number) is refused for now: it goes through the
  Loxone cloud (the `cloud` transport would bring Gladys's "prefer local"
  toggle, which needs the local path too). UDP discovery is left for later
  (the Miniserver answers on port 7071, not to the asking port: to check with
  `udp-active-broadcast`).
- Errors: refused credentials, a blocked address (4003, 429), a disabled
  user (423, 4006) and an old firmware are retried every 5 minutes; the rest
  after 5 s, doubling up to 60 s. The token of the last connection is tried
  first, the password when it is refused.
- The connection test opens its own connection (a second client for a few
  seconds) and kills its token.
- Gladys `gladys_version >= 5.1.0` (text select options, thermostat preset).
