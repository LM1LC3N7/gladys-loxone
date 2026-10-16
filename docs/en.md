# Loxone Miniserver

This integration connects Gladys to **your Loxone Miniserver** (Gen 1 or
Gen 2, firmware 11.2 or later) on your local network and offers its blocks in
the **Discovery** tab of Gladys: switches, dimmers, lighting controllers with
their moods and light circuits, blinds and curtains, gates, motorized
windows, intelligent room controllers, virtual states, meters and presence
detectors. Once a device is added, its states follow the Miniserver live, and
Gladys controls it **through the Miniserver**, which keeps running: your
Loxone Config program, your Loxone app and your automations stay as they
are. Unofficial, not affiliated with Loxone.

> **Development version (0.1).** Written from Loxone's API documents and built
> on the loxone-ts-api library, not yet tested on a real Miniserver. Your
> feedback is welcome on the GitHub repository.

## Setup

1. **Create a user for Gladys** in Loxone Config (Users and permissions),
   with a password, and give it the rooms and blocks Gladys may see and
   control. A dedicated user is advised: Gladys sees exactly what this user
   sees, and you can revoke it without touching your own account. Save the
   program to the Miniserver.
2. Find the **IP address** of the Miniserver (Loxone Config, or your router)
   and give it a fixed address in your router.
3. In Gladys, open **Integrations → Loxone Miniserver → Configuration** and
   type:
   - the **address**: `192.168.1.77`, or `192.168.1.77:8080` when the
     Miniserver does not listen on port 80. `http://` works with Gen 1 and
     Gen 2: the Miniserver encrypts the login itself. An `https://` address
     only works with the Loxone CloudDNS name of a Gen 2, not with its IP
     address (the certificate names the CloudDNS address);
   - the **user name** and **password** of the Loxone user.
4. Press **Test the connection**: the Miniserver, its generation and firmware,
   the number of blocks, the devices offered and the block types not
   supported yet show up under the button.
5. Open the **Discovery** tab and add the devices you want.

## What you get

| In Loxone                                       | In Gladys                                                                   |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| Switch, virtual input switch                    | a switch (a light in a category of the "lights" type)                       |
| Stairwell / multifunction switch (TimedSwitch)  | on/off                                                                      |
| Push button, virtual push button, scene         | on/off: on sends a pulse; every press reaches Gladys                        |
| Dimmer, EIB dimmer                              | a light: on/off, brightness                                                 |
| Lighting controller (LightControllerV2)         | a device with its moods (a list), on/off and the master brightness          |
| … its light circuits                            | one light each: on/off, brightness, color for an RGB circuit                |
| Blinds, automatic blinds, curtains (Jalousie)   | a shutter or a curtain: position (100 % = open), open, close, stop          |
| Central blinds, central gates, central windows  | open, close, stop                                                           |
| Gate, garage door                               | its position, open, close, stop                                             |
| Motorized window                                | position (100 % = open), open, close, stop                                  |
| Intelligent room controller (IRoomControllerV2) | temperature, setpoint, mode (heating, cooling, auto), preset                |
| Virtual state, analog (InfoOnlyAnalog)          | the sensor its unit says: temperature, humidity, light, power, energy, CO2… |
| Virtual state, digital (InfoOnlyDigital)        | an opening sensor (texts "open" / "closed"), a motion sensor, or a state    |
| Virtual state, text (InfoOnlyText)              | a text                                                                      |
| Utility meter (Meter)                           | power and energy; a bidirectional meter as a grid meter (import / export)   |
| Presence detector                               | a motion sensor                                                             |

Each device is named after its room: `Living room lights (Living room)`. Left
out: the blocks shown only in a system scheme, the blocks without a
visualization, and the block types not supported yet (audio, alarm, intercom,
daytimers…: the connection test names them). A secured block (visualisation
password) and a read-only one are offered read-only.

### Moods

The **Mood** list of a lighting controller offers its moods by name, the
"all off" one first. Choosing one runs it (the other moods are turned off), as the Loxone
app does. Turning the controller on runs "All on" when it exists, otherwise
your first favorite mood. A new or renamed mood shows up in the list a few
seconds later.

### Room controllers

- **Setpoint**: Gladys starts a manual override at this temperature, with no
  end, as the Loxone app does with "manual". The **Schedule** preset ends the
  override: the room follows its Loxone schedule again.
- **Preset**: Economy, Comfort, Building protection (with the names of your
  Loxone configuration) start an override of that mode.
- **Mode**: heating only, cooling only, or both (auto). The automatic or
  manual choice of Loxone is kept. Turning a room controller off is done in
  Loxone.

## Good to know

- **Live**: the Miniserver pushes every change through its WebSocket; Gladys
  sends what changed.
- **Measurements**: a meter reports its power every few seconds. Gladys keeps
  the last reading every **Minimum interval between two readings of a
  sensor** (10 s by default); switches, lights, blinds, buttons and presence
  are never delayed.
- **Changes in Loxone Config**: after you save a new program, the Miniserver
  restarts and Gladys reads its structure again at the reconnection (and
  checks it every 10 minutes); press **Scan** in Discovery to force it.
- **Connections**: the Miniserver accepts 31 live clients at most (apps,
  integrations). Gladys uses one, and one more for a few seconds during a
  connection test.
- The Miniserver **blocks an address** after repeated failed logins: after a
  password error, Gladys only retries every 5 minutes.
- **Remote Connect** (a serial number instead of an address) is not
  supported yet: Gladys and the Miniserver must be on the same network.

## Troubleshooting

- **"refused the user name or the password"**: type them again; try them in
  the Loxone app.
- **"blocks this address"**: wait a few minutes, check the password.
- **"unreachable"**: use the IP address of the Miniserver on the local
  network (not `localhost`), with its port when it is not 80, and check that
  the Gladys machine reaches it.
- **"certificate refused"**: use `http://` and the IP address.
- **"no free connection"**: close an app or another integration connected to
  the Miniserver.
- **A block is missing**: may the Loxone user see it (its room, its
  permissions)? Is it shown in a room list (not only in a system scheme)? Is
  its type supported (press **Test the connection**)?
- **A command fails with "may not control this block"**: give the Loxone user
  the right to control it, or the block is secured by a visualisation
  password (not supported yet).
