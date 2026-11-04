# Firmware (A)

Two PlatformIO projects, one shared folder.

- `tdeck/` — LilyGo T-Deck: keyboard claim, BLE advertise + scan, battery/USB state.
- `watcher/` — SenseCAP Watcher: knob claim, long-press = simulated crash, speaker, BLE.
- `common/` — shared headers both projects pull in via `lib_extra_dirs`: MQTT topic layout,
  event JSON builders (with the empty `sig` slot), screen-state enum, simulate-switch table.

Rules: devices never think — sense, show, obey. No keys on devices; identity is the
per-device MQTT credential baked in here. Plain JSON events out, commands in,
heartbeat every 10 s, last-will on death.
