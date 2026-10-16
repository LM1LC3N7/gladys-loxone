# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-16

### Added

- Connection to a Loxone Miniserver (Gen 1 or Gen 2, firmware 11.2 or later)
  on the local network, with a Loxone user and its password: token login
  (JSON Web Token, refreshed before it expires, reused at the reconnection),
  connection status, automatic reconnection.
- Every supported block of the structure file offered in Discovery, named
  after its room: switches, stairwell and multifunction switches, push
  buttons, dimmers (also EIB), lighting controllers (moods as a list, on/off,
  master brightness, one light per circuit with its color), blinds and
  curtains (position, open, close, stop), gates, motorized windows, the
  central blinds, gates and windows, intelligent room controllers
  (temperature, setpoint, mode, preset), analog virtual states (as the sensor
  their unit says), digital virtual states (opening, motion, input), text
  states, meters (power, energy, grid import and export, water and gas
  volumes) and presence detectors.
- The states follow the Miniserver live (WebSocket event tables), the values
  changed while it was unreachable come back at the reconnection; every push
  button press reaches Gladys.
- The structure is read again when the Loxone configuration changes, on Scan,
  and the mood lists are re-published when they change.
- Transport badges: unreachable when the Miniserver is, degraded when Loxone
  reports the Air or Tree motor of a blind as offline.
- "Test the connection" button: Miniserver, generation, firmware, project,
  blocks, the devices offered and the block types not supported yet.
- Sensor readings throttled to a configurable interval, all states within the
  Gladys rate limit.

[Unreleased]: https://github.com/LM1LC3N7/gladys-loxone/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-loxone/releases/tag/v0.1.1
