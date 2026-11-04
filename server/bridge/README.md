# Bridge — handover for the agents side

Devices speak MQTT to a cloud broker (EMQX serverless, TLS). Your agents speak HTTP.
This bridge is the only thing between them. Run it on the machine where your Agents API lives.

## Run it

```
cd server/bridge
npm install
copy .env.example .env     # fill in BRIDGE_PASS (ask us) and your MONAID_TOKEN
node bridge.mjs
```

- `AGENTS_API` empty → **log-only mode**: prints every device event it would POST. Start here.
- `AGENTS_API=http://localhost:4000` → forwards events to `POST /events` with `x-monaid-token`.
- `FEED_ENABLED=1` → also consumes your `GET /feed` SSE and drives device screens (see below).

## What you receive — `POST /events`

```json
{ "robotId": 1, "kind": "heartbeat", "seq": 12, "ts": 1793782787, "data": { "up": 120, "n": 12 } }
```

| Device | robotId |
|---|---|
| tdeck-01 (T-Deck) | 1 |
| watcher-01 (Watcher) | 2 |

Event kinds today:

| kind | from | data | meaning |
|---|---|---|---|
| `heartbeat` | both, every 10 s | `{up, n}` | alive |
| `down` | broker last-will | `{via:"lwt"}` | device vanished (power cut) — detected in ~8 s |
| `up` | broker | `{via:"lwt"}` | device (re)connected |
| `crash` | Watcher long-press | `{sim:true}` | simulated crash (demo trigger) |
| `recover` | Watcher release | `{sim:true}` | recovered from simulated crash |
| `click` | Watcher knob click | `{}` | worker confirm (claim) |
| `knob` | Watcher rotation | `{pos}` | dial position |
| `claim` | T-Deck keyboard | `{text:"RAJ-7"}` | typed carrier/worker id, sent on Enter |
| `power` | Watcher USB sense | `{on:true, charging:true}` | Charger-module proof: the wire went live |

Notes: `seq` is per-boot monotonic (resets on reboot — a reset is itself a signal). `ts` is device
SNTP time, may be unsynced right after boot; trust your own receive time. `data` is untrusted input.
QoS 1 means an event can occasionally arrive twice — dedupe on `(robotId, seq)` where it matters.

## Driving the screens — your `GET /feed`

With `FEED_ENABLED=1` the bridge reads your SSE stream; each `data:` line can carry:

```json
{ "robotId": 2, "screen": { "state": "JOB OPEN" } }
{ "robotId": 2, "screen": { "say": "technician on the way" } }
```

Device command set (what the bridge publishes on `monaid/<dev>/cmd`):

```json
{ "cmd": "state", "state": "JOB OPEN" }
{ "cmd": "job", "id": 7, "payout": "0.25 MON", "worker": "0x9A5E..56D7" }   // id missing/empty clears the card
{ "cmd": "say", "text": "tech on the way" }
{ "cmd": "simulate", "kind": "crash" }   // any event kind; device emits it with data.sim=true
```

`state` is free text up to 15 chars; the demo set: `IDLE, BIDDING, JOB OPEN, CLAIMED, PAID, BLOCKED`.

Until your feed exists, test screens by hand:

```
node cmd.mjs watcher-01 state "JOB OPEN"
node cmd.mjs tdeck-01 say "hello robot"
```

## Credentials

Broker host and the `bridge` MQTT password are NOT in git — ask us directly.
Device credentials stay on our side; your side never touches MQTT besides this bridge.
