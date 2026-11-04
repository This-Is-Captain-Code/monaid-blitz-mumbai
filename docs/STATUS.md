# Monaid — Status

_Last updated: 2026-11-04, after P0 (re-scope)._

**My scope:** `contracts/`, `agents/`, `shared/`, `docs/` only — wallets, funding, transactions, robot agents,
Muse logic, guardrails, and an API for teammates. Firmware, broker, MQTT bridge, screens, portal UI and
WhatsApp transport belong to teammates.

## Plan

| Step | Title | Status |
|---|---|---|
| P0 | Stop and re-scope | done |
| P1 | Finish the payment contract (MonaidCore v0) | **done and merged** (PR #1) |
| P2 | Wallet manager and funding | **next** — branch `step2/wallets` |
| P3 | Transaction sender | — |
| P4 | Jobs in the contract (MonaidCore v1) | — |
| P5 | Robot agents and off-chain guardrails | — |
| P6 | Agents API for teammates | — |
| P7 | Muse (decision logic only) | — |
| P8 | Module contract (Charger / Lost / Down, team picks) | — |
| P9 | Demo hardening | — |

### P1 leftovers (not done, small)

- Explicit 0-value self-tx from AGENT_1 to confirm the reserve-balance finding (only indirect evidence so far, see Findings).
- Export the MonaidCore ABI to `shared/`.

## Broker — handed to teammate

The broker belongs to a teammate. The local `broker/` folder (Mosquitto config, ACL, credentials/run scripts,
ACL test — never run, never committed) is kept as-is and excluded locally via `.git/info/exclude`.
Mosquitto 2.1.2 is installed on the laptop (winget); its Windows service runs on `localhost:1883`. Not touched further.

## Deployed (Monad testnet, chain 10143)

| Contract | Address | Notes |
|---|---|---|
| MonaidCore v0 | `0xDD22ee7923195EbBcC247d40553BCB138A6D5BBf` | [verified on MonadVision](https://testnet.monadvision.com/contracts/full_match/10143/0xDD22ee7923195EbBcC247d40553BCB138A6D5BBf/) · deploy tx [0x51f331c8…](https://testnet.monadscan.com/tx/0x51f331c895125db91a67994d4e23459c9655585ca64cd6d05906f7a645a771b0) · block 76858867 |

Machine-readable copy: `shared/addresses.json`.

## Wallets

Keys currently in `contracts/.env` (move to `agents/.env` in P2).

| Name | Address | Role | Balance (end of P1) |
|---|---|---|---|
| DEPLOYER | `0x639B5bE0679EC82C7224F31d04bb3dD093222d5D` | owns MonaidCore, funds robots | 14.9237 MON |
| AGENT_1 | `0x31443AB8d8F13E16b86bfcDB4b965320E560824A` | robot 1's agent | 4.9872 MON |

Demo-only addresses (no keys): robot `0x478962782092A83697F4d5BC9c44bc1e5Ba572a6` (registered to AGENT_1 in v0,
0.005 MON in core), technician `0x9A5E9183193DA5978efc86e537604f1f787456D7` (received 0.005 MON).

## Findings

- **Reserve balance — gas-only agent wallets appear able to sit below 10 MON.** AGENT_1 held 5 MON and its `pay` tx
  ([0xf37442bb…](https://testnet.monadscan.com/tx/0xf37442bb4a1f6e2ca6854589e797aa50702101a22187900cf39d28ad342cca96))
  succeeded: the reserve rule restricts value sent out of a wallet, not gas. Wallets that send value
  (DEPLOYER via `fund`) must stay above ~12 MON. Explicit self-tx check still pending (P1 leftover).
- **Gas limit = gas charged.** Monad receipts report `gasUsed` equal to the limit. Scripts estimate +15%.
  Typical fees at ~102–115 gwei: deploy ≈ 0.052 MON, `registerRobot` ≈ 0.006, `fund` ≈ 0.008, `pay` ≈ 0.013.
- Ignition deploys use the raw estimate as the limit (no margin); fine so far.

## MON spent

| Step | Spent |
|---|---|
| P1 | ≈ 0.079 MON gas + 0.01 MON sent into MonaidCore |

## Open items

- `CLAUDE.md` on `main` is still the previous brief (mentions `server/`, broker, MQTT). Waiting for the narrower brief.
- MonaidCore v0 has no way to change a robot's agent after registration.
- Monadscan verification skipped (no `ETHERSCAN_API_KEY`); MonadVision is the verify target.
