# Monaid — Status

_Last updated: 2026-11-04, end of P2; next P3._

**My scope:** `contracts/`, `agents/`, `shared/`, `docs/` only — wallets, funding, transactions, robot agents,
Muse logic, guardrails, and an API for teammates. Firmware, broker, MQTT bridge, screens, portal UI and
WhatsApp transport belong to teammates.

## Plan

| Step | Title | Status |
|---|---|---|
| P0 | Stop and re-scope | done (new CLAUDE.md committed) |
| P1 | Finish the payment contract (MonaidCore v0) | done and merged (PR #1); leftovers done on `step2/wallets` |
| P2 | Wallet manager and funding | **done** — branch `step2/wallets` (not merged) |
| P3 | Transaction sender | **next** |
| P4 | Jobs in the contract (MonaidCore v1) | — |
| P5 | Robot agents and off-chain guardrails | — |
| P6 | Agents API for teammates | — |
| P7 | Muse (decision logic only) | — |
| P8 | Module contract (Charger / Lost / Down, team picks) | — |
| P9 | Demo hardening | — |

## Broker — handed to teammate

The broker belongs to a teammate. The local `broker/` folder (Mosquitto config, ACL, credentials/run scripts,
ACL test — never run, never committed) is kept as-is and excluded locally via `.git/info/exclude`.
Mosquitto 2.1.2 is installed on the laptop (winget); its Windows service runs on `localhost:1883`. Not touched further.

## Deployed (Monad testnet, chain 10143)

| Contract | Address | Notes |
|---|---|---|
| MonaidCore v0 | `0xDD22ee7923195EbBcC247d40553BCB138A6D5BBf` | [verified on MonadVision](https://testnet.monadvision.com/contracts/full_match/10143/0xDD22ee7923195EbBcC247d40553BCB138A6D5BBf/) · deploy tx [0x51f331c8…](https://testnet.monadscan.com/tx/0x51f331c895125db91a67994d4e23459c9655585ca64cd6d05906f7a645a771b0) · block 76858867 |

Machine-readable: `shared/addresses.json` (contract, wallets, robots) and `shared/abi/MonaidCore.json`.

## Wallets

All keys live in `agents/.env` (git-ignored); `contracts/` reads from it. `contracts/.env` no longer exists.
Funding rules (`agents/config.json`): DEPLOYER hard floor **12 MON** (every DEPLOYER value send checks it first and
refuses with what is still spendable); agent gas floor **1 MON**, top-up target **3 MON**, top-ups capped at
**10 MON per UTC day** (ledger `agents/logs/topups.jsonl`).

| Name | Address | Role | Balance (end of P2) | Spendable (balance − floor) |
|---|---|---|---|---|
| DEPLOYER | `0x639B5bE0679EC82C7224F31d04bb3dD093222d5D` | owner / funder | 25.8926 MON | 13.8926 MON |
| AGENT_1 | `0x31443AB8d8F13E16b86bfcDB4b965320E560824A` | agent, robot 1 | 4.9847 MON | 3.9847 MON |
| AGENT_2 | `0x16Cd0840ba8d68B526D5F5D9EB72626bB7A1CA45` | agent, robot 2 | 3.0000 MON | 2.0000 MON |

### Robots (registered in MonaidCore v0)

| Robot | Robot address (derived from id, no key) | Agent | Balance in core |
|---|---|---|---|
| 1 | `0xB46d4FeCEFd31C1531FA84Dd61228b9Ea5107077` | AGENT_1 | 0.5 MON |
| 2 | `0xE1f9bf1554a484d8993bF19e4cF02B79e4ccF254` | AGENT_2 | 0.5 MON |

Old v0 demo-only addresses (no keys): robot `0x478962782092A83697F4d5BC9c44bc1e5Ba572a6` (AGENT_1, 0.005 MON in core),
technician `0x9A5E9183193DA5978efc86e537604f1f787456D7`.

### P2 transactions

| What | Tx | Fee MON |
|---|---|---|
| registerRobot 1 → AGENT_1 | [0x6d9a9cb1…](https://testnet.monadscan.com/tx/0x6d9a9cb11657f32d1387483dde048642cd6eb68cedd0423aa29b733fef9bc26f) | 0.0062 |
| registerRobot 2 → AGENT_2 | [0xa884ab5e…](https://testnet.monadscan.com/tx/0xa884ab5e99465779a905467042b8afe27b407df01c735de556f5f5383edfd7a9) | 0.0062 |
| top up AGENT_2, 3 MON | [0x6780b760…](https://testnet.monadscan.com/tx/0x6780b7601e1a7a9e7a282ce9fe72054d92e22565091131e64159cd0ab6fede12) | 0.0025 |
| fund robot 1, 0.5 MON | [0x20b6784e…](https://testnet.monadscan.com/tx/0x20b6784e2adf9ae8913b542f716548f1b8a3f980ec0019aa7b2583b657250af1) | 0.0081 |
| fund robot 2, 0.5 MON | [0xc1debb4b…](https://testnet.monadscan.com/tx/0xc1debb4bd92c56c0b8664014cf218db95bdfff61deb0fbdda00ad12ea68e960d) | 0.0081 |

## Findings

- **Reserve balance — TESTED: gas-only wallets CAN sit below 10 MON.** AGENT_1 at 4.9872 MON sent a 0-value
  self-tx ([0x49cfba7a…](https://testnet.monadscan.com/tx/0x49cfba7a8c66bd4a150f5de63583351cf45056453f046771a0b1e9da9fe0a580)):
  success, gas limit 24,150 (21,000 + 15%) at 103 gwei = 0.0024875 MON; balance 4.9872 → 4.9847 MON.
  Its earlier `pay` call at 5 MON also succeeded. The reserve rule only restricts **value** sent out of a wallet.
  **Rule for agents:** agent wallets only pay gas, so they may sit below 10 MON; gas floor 1 MON.
  Wallets that send value (DEPLOYER via `fund`/top-ups) must stay ≥ 12 MON.
- **Gas limit = gas charged.** Monad receipts report `gasUsed` equal to the limit. Scripts estimate +15%.
  Typical fees at ~102–115 gwei: deploy ≈ 0.052 MON, `registerRobot` ≈ 0.006, `fund` ≈ 0.008, `pay` ≈ 0.013,
  plain transfer ≈ 0.0025.
- Ignition deploys use the raw estimate as the limit (no margin); fine so far.

## MON spent

| Step | Spent |
|---|---|
| P1 | ≈ 0.079 MON gas + 0.01 MON sent into MonaidCore |
| P1 leftovers | 0.0024875 MON (AGENT_1 self-tx) |
| P2 | 0.0311 MON gas; moved 3 MON DEPLOYER → AGENT_2 and 1 MON into MonaidCore (robots 1, 2). You added 15 MON to DEPLOYER by hand. |

## Open items

- MonaidCore v0 has no way to change a robot's agent after registration.
- Monadscan verification skipped (no `ETHERSCAN_API_KEY`); MonadVision is the verify target.
- P2 funding scripts send directly (estimate +15%); P3 switches them to the shared `sendTx` queue + audit log.
