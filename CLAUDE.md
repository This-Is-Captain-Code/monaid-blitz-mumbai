# Monaid — Project Brief for Claude Code

**First aid for robots, paid in MON.** A robot in trouble posts a job, a human fixes it, and payment
releases on a physical proof that comes straight from the device. Hackathon: Monad Blitz. ~7 hours total.

Current step, progress and deployed addresses live in `docs/STATUS.md`, not here. Read it after this file.
Update it and commit it (`docs:` commit) at the end of every step.

## Team split

- **Firmware (A)** — teammate. ESP32 boards: LilyGo T-Deck + Watcher. Do not edit `firmware/` unless I ask.
- **Server (B) and Contracts (C)** — me, with you (Claude Code).

## Non-negotiable rules

1. **Devices never think.** They sense, show, obey. No logic or decisions on devices.
2. **All agents, wallets and crypto live on the server.** No keys on devices.
   One agent per robot, each with its own wallet. Muse is the owner's agent.
3. **Device identity is broker identity.** Per-device MQTT username/password, topic ACLs.
   A device can publish only to its own topics. The server trusts the topic, never a device ID inside a payload.
4. **The chain gates money. It is not a log.** Only things that move or lock money go on-chain.
   Heartbeats and chatter stay off-chain.
5. **Everything in MON** (native token). No ERC-20s.
6. **One network:** a phone hotspot. Devices, laptop, phone all on it.
7. **Every revert is a demo beat.** Custom errors with clear names (`JobNotClaimed`, `ClaimExpired`,
   `NotRobotAgent`, `AlreadySettled`), readable on the explorer.

## Modules (one core, one module chosen for the demo; core first)

- **Charger** — two robots auction one charger; human paid to swap the cable; proof = winner sees USB power.
- **Lost** — lost robot posts a bounty rising per block; proof = both devices see each other over BLE.
- **Down** — robots heartbeat and watch each other; technician revives one; proof = first heartbeat after the fix.

Do not build any module until the core is deployed and tested.

## Repo layout

```
contracts/   Hardhat 2 + viem. Solidity + TypeScript tests.
server/      TypeScript + viem: MQTT bridge, robot agents, Muse bridge, portal.
broker/      Mosquitto config: password file template, ACL file, run script.
firmware/    Teammate's ESP32 code.
shared/      Event/command schemas, ABIs, deployed addresses (addresses.json). Single source of truth.
docs/        STATUS.md, demo script, notes.
```

Toolchain: Node 20 (so Hardhat 2, not 3). TypeScript pinned to 5.8 (ts-node crashes on 7).

## Keys and secrets

- All private keys live in ONE place: `server/.env`. Contracts scripts read from there too
  (move them out of `contracts/.env` when `server/` is created; tell me before you do).
- Wallets: `DEPLOYER` (owns MonaidCore, funds robots), `AGENT_<robot>` (one per robot).
- `wallet:new` writes keys to `.env` and prints only addresses. Never print or log a private key.
- MQTT passwords: generated, stored in `server/.env` (server) and given to me for firmware. Never committed.
  Commit only `.env.example` and a password-file *template*.

## Git rules

- **One folder per commit.** A commit touches only one top-level folder.
  Root files (`.gitignore`, `CLAUDE.md`, root README) go in their own `chore:` commit.
- Message format: `<folder>: <what changed>` e.g. `contracts: add job claim and settle`.
- Small commits; each leaves build and tests passing.
- Branch per step; never commit to main directly. Ask me before PRs or merges.
- Never commit `.env`, keys, passwords. Check `git status` before every commit.

## Network facts (Monad testnet)

- Chain ID `10143`, gas token MON (18 decimals). RPC `https://testnet-rpc.monad.xyz`
  (≈50 rps, only 25 rps for `eth_call`/`eth_estimateGas`). Backup: `https://rpc.ankr.com/monad_testnet`.
- Explorers: `https://testnet.monadvision.com` (verify here, no key needed), `https://testnet.monadscan.com`.
- Faucet: `https://faucet.monad.xyz` (manual, done by me).
- **Gas is charged on the gas LIMIT, not gas used.** Estimate and add ~15%. Never set big fixed limits.
- **Reserve balance:** a send of MON out of a wallet is blocked if it would leave < 10 MON.
  Wallets that send value (DEPLOYER) stay above ~12 MON. Whether gas-only agent wallets can sit below
  10 MON is recorded in `docs/STATUS.md` once tested — follow that result.
- Testnet was reset 2025-12-16. Only trust addresses from docs.monad.xyz or ones we deploy.
- Sub-second finality: treat a receipt as final.

## Broker (Mosquitto, on the laptop)

- `allow_anonymous false`, `password_file`, `acl_file`. Listener on the hotspot interface, port 1883.
- The laptop's IP changes per hotspot session: print it on broker start; prefer mDNS (`monaid.local`) if it works.
- Topics, where `<id>` = the device's MQTT username:
  - `monaid/dev/<id>/evt`    device → server (events)
  - `monaid/dev/<id>/hb`     device → server (heartbeat, every 10 s)
  - `monaid/dev/<id>/status` device last-will `offline`, retained; device publishes `online` on connect
  - `monaid/dev/<id>/cmd`    server → device (commands)
- ACL: devices use `pattern` rules on `%u` — write to their own `evt`, `hb`, `status`; read their own `cmd`. Nothing else.
  Server user: read `monaid/dev/+/evt|hb|status`, write `monaid/dev/+/cmd`.
- Test ACLs: a device credential publishing to another device's topic must be rejected. Keep this test runnable.

## Message schemas (shared/, versioned)

Event (device → server), plain JSON:
```json
{ "v": 1, "kind": "claim", "seq": 42, "ts": 1730700000, "data": { }, "sig": "" }
```
- `kind`: `claim`, `power_on`, `power_off`, `beacon_seen`, `knob`, `key`, `crash` (simulated).
- `seq`: increasing per device; the server drops duplicates and replays (`seq` ≤ last seen).
- `sig`: always empty in the demo. Reserved slot for device signing (see Roadmap). Do not remove it.
- No device ID in the payload — identity comes from the topic.

Command (server → device): `{ "v": 1, "cmd": "show_job" | "show_state" | "say" | "simulate", "data": { } }`.
Screen states: `idle`, `bidding`, `job_open`, `claimed`, `paid`, `blocked`. Screen is a pure function of commands.

Heartbeat: `{ "v": 1, "seq": n, "batt": 87, "usb": true }`.

## Server

- MQTT bridge: topic → device → robot. Validates schema, drops bad/duplicate events, logs every event.
- Robot agent per robot: owns its wallet; turns proofs into contract calls; pushes screen commands.
- Down detection: missed heartbeats + LWT `offline` (target: alert within ~8 s of power-off; tune keepalive).
- Muse: owner gets a WhatsApp link → forwards to Muse → Muse's pick comes back. Later step.
- Portal: jobs, claims, explorer links, and an **"owner decides"** button that bypasses Muse.
- Every contract call: estimate gas +15%, log tx hash + explorer link, push result to device screens.

## Contracts

Core (`MonaidCore`), building on v0 (register, fund, pay, pause):
- `registerRobot(robot, agent)` owner only. `fund(robot)` payable.
- `postJob(robot, payout, claimWindow)` — only the robot's agent; escrows payout from the robot's balance.
- `claim(jobId, worker)` — records the worker; claim expires after `claimWindow`.
- `settle(jobId)` — only the robot's agent attests the proof; pays the worker. Reverts if not claimed, expired, or settled.
- `expire(jobId)` — anyone, after the window: job back to open (or cancelled), escrow returned. This is the fail-path beat.
- `cancel(jobId)` — robot's agent, if unclaimed.
- Guardrails: per-job max payout (owner-set), payout escrowed at post time, only the robot's agent posts/settles,
  owner pause, checks-effects-interactions, send via `call`, events for everything.

Modules (later, only one for the demo):
- Charger: bid, settle second-price, attest charging, release.
- Lost: bounty rising per block, set cap, attest home when both agents report the beacon, cancel.
- Down: flag down, set price, settle on first heartbeat after claim (heartbeats stay off-chain; the agent attests).

**Roadmap (not demo scope):** devices sign the same event payload with a burned-in key; `settle` verifies it with
`ecrecover`. Same message, same flow — verification moves from broker to chain. The `sig` field is already there.

## Step sequence

1. MonaidCore v0 (register, fund, pay, pause), tests, deploy, `demo:pay`.
2. Broker: Mosquitto config, per-device credentials, ACLs, ACL rejection test.
3. Server MQTT bridge + one robot agent. **Gate:** a device event on its ACL'd topic → mapped to the right robot →
   contract call on the explorer. (A script can stand in for the device until firmware is ready.)
4. Core jobs: post, claim, settle, expire, cancel + tests + redeploy.
5. Commands/screens, second robot, portal with "owner decides".
6. Chosen module contract + sensor flow.
7. Muse bridge.
8. End to end: one happy path, one fail path. Demo script in `docs/`.

## Reporting rules (always)

Tell me clearly, every time:
- Every **address** you create and its purpose. Never a private key or password.
- Every **on-chain transaction**: what it does, tx hash, explorer link.
- **MON spent** per step and remaining balances.
- Any change to `.env`, `.gitignore`, credentials, ACLs, or anything touching keys.
- Anything installed, upgraded or pinned, and why.
- Any **deviation** from this brief — before you do it, not after.
- When I need to do something by hand (faucet, phone, hardware, firmware credentials), stop and say so plainly.

## Gates (for context)

- Hour 1: both boards online, heartbeats flowing, wallets funded.
- Hour 2: device event → ACL'd topic → right robot → contract call on the explorer.
- Hour 5: one full happy path, one full fail path.
- Hour 6 buffer, hour 7 rehearse three times.

## Demo (for context)

Explorer open with both agent wallets. Happy path: trigger → job on screens → Muse → claim → fix → proof → paid.
Fail path: claim without fixing → timeout → blocked. Death beat: power button, ~8 s to alert.
Revival: power on, first heartbeat, technician paid. Test "owner decides" and every simulate switch before going on.
"What stops a fake proof?" → per-device broker credentials + topic ACLs today; device-signed payloads verified on-chain
is the upgrade, and the `sig` field is already in the message.
