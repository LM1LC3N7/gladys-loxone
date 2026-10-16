# gladys-loxone

[Gladys Assistant](https://gladysassistant.com) external integration bridging a
**Loxone Miniserver** (Gen 1 and Gen 2, firmware 11.2 or later) on the local
network: its blocks become Gladys devices of the Discovery tab, named after
their room, their states follow the Miniserver live through its WebSocket
event tables, and Gladys controls them through the Miniserver, which keeps
running. Made for Loxone users who want Gladys next to their Loxone app, or
move to it at their own pace. Unofficial, not affiliated with Loxone.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> Work in progress (0.1, not published to the store yet): announced on the
> [Gladys forum](https://community.gladysassistant.com/t/integrations-home-assistant-les-plus-populaires-candidates-pour-des-integrations-externes-gladys/10385/224).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (LoxoneApp) ⇄ src/loxone.js ⇄ loxone-ts-api ⇄ Miniserver (HTTP + WebSocket)
                                   ├─ src/structure.js  LoxAPP3.json -> controls with room and category (pure)
                                   ├─ src/mapping.js    one control -> features, readers, writers (pure)
                                   ├─ src/devices.js    controls -> Gladys devices + routing tables (pure)
                                   └─ src/publisher.js  states within 300/min, sensor throttling, presses
```

- **Connection**: `GET /jdev/cfg/apiKey` first, without credentials (serial
  number, firmware, Gen 2 HTTPS status; a firmware older than 11.2 is refused
  here). Then [loxone-ts-api](https://github.com/andrasg/loxone-ts-api) opens
  the WebSocket (`/ws/rfc6455`, protocol `remotecontrol`), exchanges the
  session key, acquires a JSON Web Token with the user and password
  (`getkey2`, `getjwt`, command encryption) and refreshes it before it
  expires. A reconnection logs in with the last token, the password only
  when the token was refused. The client UUID is derived from the Gladys
  integration, so the Miniserver lists one client for Gladys.
- **Structure**: `data/LoxAPP3.json` at each connection, on Scan, and when
  `jdev/sps/LoxAPPversion3` (asked every 10 minutes) reports a new
  `lastModified`. Rooms and categories name the devices
  (`<block> (<room>)`); a block hidden from the room lists (restrictions bit 0) is left out; a read-only or secured block (visualisation password) is
  offered read-only.
- **Mapping** (Loxone "Structure File" document): Switch, TimedSwitch,
  Pushbutton, Dimmer, EIBDimmer, ColorPickerV2, LightControllerV2 (moods as a
  select, on/off, master brightness; one device per light circuit), Jalousie
  (position, open / close / stop; curtains by their animation), Gate, Window,
  the central objects of blinds, gates and windows, IRoomControllerV2
  (temperature, setpoint, mode, preset), InfoOnlyAnalog (the kind and unit
  read from its format), InfoOnlyDigital (opening contact, motion or input),
  InfoOnlyText, Meter (power and energy, a bidirectional meter as a grid
  sensor, water and gas volumes), PresenceDetector. The other types are
  listed by the connection test and in TODO.md.
- **Live states**: `jdev/sps/enablebinstatusupdate` makes the Miniserver
  send every state, then each change, as value and text event tables keyed by
  state UUID. Each feature is read again when one of its states changes, and
  sent with `publishChangedStates` (changes only, within the rate limit; the
  measurements spaced by the configured interval). A push button is 1 then 0
  within a second: its changes go through `publishStates`, in order. A mood
  list that changes re-publishes the devices (the select options).
- **Commands**: `jdev/sps/io/<uuid>/<command>` through the library: `on`,
  `off`, `pulse`, a dimmer position, `hsv(h,s,v)` / `temp(b,k)`,
  `changeTo/<mood>`, `FullUp`, `FullDown`, `manualPosition/<0–100>`, `stop`,
  `open`, `close`, `moveToPosition/<0–100>`, `override/3//<°>`,
  `setOperatingMode/<n>`, `override/<mode>`, `stopOverride`.
- **Failures**: Miniserver unreachable → status message and `unreachable`
  transport badges, reconnection after 5 s, doubling up to 60 s, with a fresh
  client; refused credentials, a blocked address (close code 4003) or a
  disabled user: every 5 minutes. A Jalousie whose Air or Tree motor is
  offline (`deviceState` 1) gets a degraded badge.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/loxone.js` is a structure file of a small house written after
Loxone's "Structure File" document (one block of each mapped type, plus
unsupported, hidden, secured and untyped ones) with the values of its states;
`test/helpers/fakeLoxone.js` stands for loxone-ts-api at its boundary (its
`LoxoneClient` surface, its log wording) and for the `jdev/cfg/apiKey` answer.
The app tests run the real SDK wiring against the SDK's fake Gladys; a few
tests run the real library classes (event table decoding, the message guard,
the log lines). The production image was also run read-only under the Gladys
limits with the real library over a real socket against a simulated Gen 1
Miniserver (key exchange, command encryption, token login, event tables,
commands, reconnection). No real Miniserver was available: see TODO.md for
what needs one.

## Credits

- [loxone-ts-api](https://github.com/andrasg/loxone-ts-api) (MIT, Andras
  Gaal), the runtime dependency: token authentication for Gen 1 and Gen 2,
  command encryption, the WebSocket protocol, the event tables, commands.
  Used as is (see TODO.md "Decisions" for how it is wrapped).
- Loxone's [Structure File](https://www.loxone.com/wp-content/uploads/datasheets/StructureFile.pdf)
  and [Communicating with the Miniserver](https://www.loxone.com/wp-content/uploads/datasheets/CommunicatingWithMiniserver.pdf)
  documents: control types, states, commands, error and close codes.
- Read as references for the behaviour of the controls (no code copied):
  [matterbridge-loxone](https://github.com/andrasg/matterbridge-loxone) (MIT),
  [homebridge-loxone-proxy](https://github.com/rudyberends/homebridge-loxone-proxy)
  (Apache-2.0) and [ioBroker.loxone](https://github.com/UncleSamSwiss/ioBroker.loxone)
  (Apache-2.0): moods 777 / 778, master brightness, blinds at their end
  positions, the room controller override.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0 (see NOTICE for the third-party credits). Loxone and Miniserver are
trademarks of Loxone Electronics GmbH; this project is not affiliated with
Loxone.
