# Monaid

**First aid for robots, paid in MON.** A robot in trouble posts a job on Monad, a human fixes it,
and payment releases on a physical proof straight from the device.

Built at **Monad Blitz Devcon Mumbai** with two ESP32 robots, a cloud broker, and one escrow contract.

## Three modules, one escrow core

- **Wake Me Up** — robots watch each other; when one goes silent it funds its own revival job on
  Monad, and the technician is paid the moment it comes back to life.
- **One charger, two robots** — robots auction a scarce charger on Monad, the winner pays the loser
  to yield, and a human gets paid to swap the cable the instant the winner's firmware sees power.
- **Bring Me Home** — a lost pocket robot posts a rising bounty on itself, and whoever carries it
  back gets paid when the two devices reunite.

## How it works

```
T-Deck ──┐                              ┌─> agents (one wallet per robot,
         ├── mqtts (TLS, per-device ────┤    Claude picks the worker)
Watcher ─┘   creds + ACLs) ─> EMQX ─> bridge                │
                                        │                   ▼
   screens <── state/job/say commands ──┘        MonaidCore on Monad
                                                 (escrow, time-locked claims,
                                                  settle on proof, expire)
```

**System rules:** devices never think — they sense, show, obey. No keys on devices; device identity
is broker identity (per-device MQTT credentials, topic ACLs). All wallets and crypto live on the
server. The chain gates money; it is not a log. Everything in native MON.

**The proof is physical.** Settlement fires on an event only the device can produce: a revived
robot checking back in, the VBUS pin going live after a cable swap, both devices seeing each
other again. Every event carries an empty `sig` slot — the production upgrade is devices signing
payloads with a burned-in key and `settle` verifying via `ecrecover`. Same message, same flow.

**Every revert is a demo beat:** claim a job and fix nothing, the claim window expires on-chain and
the screen goes red. Cheating is a feature of the demo.

## Deployed (Monad testnet, chain 10143)

| What | Where |
|---|---|
| MonaidCore v0 | [`0xDD22ee7923195EbBcC247d40553BCB138A6D5BBf`](https://testnet.monadvision.com/contracts/full_match/10143/0xDD22ee7923195EbBcC247d40553BCB138A6D5BBf/) (verified) |
| Addresses & ABI | [`shared/addresses.json`](shared/addresses.json) · [`shared/abi/MonaidCore.json`](shared/abi/MonaidCore.json) |

## Hardware

| Robot | Board | Senses / acts |
|---|---|---|
| robot 1 | LilyGo T-Deck Plus (ESP32-S3) | keyboard, battery voltage, screen |
| robot 2 | Seeed SenseCAP Watcher (ESP32-S3) | knob, USB-power detect, crash button, screen |

Screens run a stage-mode UI: the whole display is the state — orange `JOB OPEN`, cyan `CLAIMED`,
green `PAID`, magenta `LOST`, red `BLOCKED` — with the payout in MON front and center.

## Repo layout

```
firmware/   ESP-IDF firmware: tdeck/, watcher/, common/monaid_net (WiFi + MQTT + last-will)
server/     bridge/ (broker <-> agents translator, self-test), broker/ (local Mosquitto fallback)
contracts/  MonaidCore (Hardhat + viem), tests, deploy scripts
agents/     wallets, funding, tx queue, robot agents, worker selection (Claude), guardrails
shared/     ABI, addresses — the files teammates build against
docs/       STATUS.md (live progress), API docs
```

## Run it

- **Firmware:** `firmware/{tdeck,watcher}/idf.ps1 build flash` (ESP-IDF 5.5; copy
  `wifi_creds.example.h` to `wifi_creds.h` with your hotspot + broker credentials).
- **Bridge:** `cd server/bridge && npm install && node bridge.mjs` (log-only without an API;
  `node selftest.mjs` round-trips simulate commands through the live broker).
- **Contracts / agents:** see `contracts/` and `agents/` READMEs.

## Status

Live today: both robots on the cloud broker over TLS, liveness with ~8 s last-will death
detection, simulated crash/recover, USB-power proof, typed claims, full screen choreography, bridge with
round-trip self-test, MonaidCore v0 deployed with registered + funded robots. In progress: job
flow wiring (post/claim/settle through the bridge), module contracts, Claude worker selection,
portal.
