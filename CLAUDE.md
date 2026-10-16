# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 24+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It
connects to the user's Loxone Miniserver (Gen 1 / Gen 2, firmware 11.2+) on
the local network through [loxone-ts-api](https://github.com/andrasg/loxone-ts-api)
(token login, WebSocket event tables, commands), reads its structure file
(LoxAPP3.json), turns its blocks into Gladys devices, follows their states
live and sends the Gladys commands back. Unofficial, not affiliated with
Loxone.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/mapping.test.js          # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit. The CI
runs them on Node 24 and 26 and builds the Docker image.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          LoxoneApp: connection lifecycle, structure reloads, states,
                    commands, transports, connection test
src/loxone.js       the only network access: probe (jdev/cfg/apiKey), the
                    loxone-ts-api wrapper (Connection), failure kinds, log routing
src/structure.js    LoxAPP3.json -> controls with room, category, restrictions (pure)
src/mapping.js      one control -> Gladys devices, features, readers, writers (pure)
src/devices.js      controls -> Gladys devices + routing tables (pure)
src/values.js       formats -> units, hsv/temp colors, JSON texts
src/publisher.js    states within the Gladys rate limit, push button events
src/config.js       config_schema normalized (address of the Miniserver)
src/constants.js    manifest keys, limits, timings
src/i18n.js         runtime texts (en/fr)
test/fixtures/      a LoxAPP3.json written after Loxone's Structure File document
test/helpers/       a fake Miniserver at the boundary of loxone-ts-api; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `loxone:<control UUID>` (lower case,
  `/` of a light circuit turned into `-`), feature = `<key>` (`binary`,
  `brightness`, `color`, `mood`, `position`, `state`, `temperature`,
  `setpoint`, `mode`, `preset`, `power`, `energy`, `energy-export`, `volume`,
  `humidity`, `illuminance`, `battery`, `co2`, `pressure`, `speed`,
  `precipitation`, `noise`, `currency`, `percent`, `value`, `voltage`,
  `current`, `opening`, `motion`, `input`, `text`). Never change how they are
  built.
- The manifest keys (`test_connection`, the config keys) are frozen: users
  store them in their configuration.
- Commands go to the `uuidAction` as the structure file writes it; lookups
  use lower-case UUIDs.
- loxone-ts-api is used as is, through `src/loxone.js` only (see TODO.md
  "Decisions": its own reconnection off, its logs routed, its firmware check
  done before it, its message handler guarded). Do not patch it in
  `node_modules`; report upstream.
- Value conventions: the Gladys side follows the enums of
  `server/utils/constants.js` (copied in `src/mapping.js`, the SDK does not
  export them). Gladys shutter position 100 = open; Loxone Jalousie position
  0 = open. Door/window: Gladys `OPENING_SENSOR_STATE` OPEN 0 / CLOSE 1.
- Push button changes go through `publishStates` (`publisher.pushEvent`),
  never `publishChangedStates`: a press is 1 then 0 within a second.
- Never send a unit Gladys does not know: the whole device list would be refused.
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only).
- Gladys rate limits: 300 states/min, 300 scene events/min.
- Never log or put in a status message the password or a token.
- Tests never touch the network: `test/helpers/fakeLoxone.js` stands for the
  library and the Miniserver. The real path needs a real Miniserver (see TODO.md).
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
