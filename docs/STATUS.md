# Monaid — Status

_Last updated: 2026-11-04, end of P3; next P4._

**My scope:** `contracts/`, `agents/`, `shared/`, `docs/` only — wallets, funding, transactions, robot agents,
Muse logic, guardrails, and an API for teammates. Firmware, broker, MQTT bridge, screens, portal UI and
WhatsApp transport belong to teammates.

## Plan

| Step | Title | Status |
|---|---|---|
| P0 | Stop and re-scope | done (new CLAUDE.md committed) |
| P1 | Finish the payment contract (MonaidCore v0) | done and merged (PR #1, leftovers in PR #2) |
| P2 | Wallet manager and funding | done and merged (PR #2) |
| P3 | Transaction sender | **done** — branch `step3/sendtx` (not merged) |
| P4 | Jobs in the contract (MonaidCore v1) | **next** |
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

| Name | Address | Role | Balance (end of P3) | Spendable (balance − floor) |
|---|---|---|---|---|
| DEPLOYER | `0x639B5bE0679EC82C7224F31d04bb3dD093222d5D` | owner / funder | 25.8766 MON | 13.8766 MON |
| AGENT_1 | `0x31443AB8d8F13E16b86bfcDB4b965320E560824A` | agent, robot 1 | 4.9342 MON | 3.9342 MON |
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

### P3 — sendTx (`agents/src/tx.ts`)

One path for every tx: DEPLOYER floor check → simulate → estimate +15% → sign with local nonce → send → receipt.
Per-wallet serial queue; network-error retries only (same signed tx); custom errors decoded; audit log in
`agents/logs/audit.jsonl` (git-ignored). Funding commands and `demo:pay` (moved from contracts/ to agents/) use it.

**Nonce proof** (`npm run proof:sendtx`): 5 concurrent `pay` calls from AGENT_1 → nonces 2,3,4,5,6, all success,
chain order = nonce order, no nonce errors, ~1.9 s per tx (serial: each waits for its receipt).
[#1](https://testnet.monadscan.com/tx/0xee66f2cc67576f6fa56084ff2a7c476e8d310057622372dcf77e0127821992fb) ·
[#2](https://testnet.monadscan.com/tx/0x96f32c5ebcb9ccdbf47fcaaf055df9b321b16454f93448bce8f497007725602d) ·
[#3](https://testnet.monadscan.com/tx/0xd25f152d99a4be462f9b6fa3c66146431b534dd3b8b8b12464c2611208aae4c9) ·
[#4](https://testnet.monadscan.com/tx/0x71b7dd505e9aa8fc386e99499bcabc1031b84046ed1b757e88a681f7ba39120b) ·
[#5](https://testnet.monadscan.com/tx/0x18f7d9bb6fed2ee987d08736cbec699e2d10384c0e4a9653a0b4a08b00f8fc44).
Overspend caught at simulate: `InsufficientBalance(495000000000000000, 1000000000000000000000)`, not sent, 0 gas.

`demo:pay` via sendTx: [fund 0.01](https://testnet.monadscan.com/tx/0xbc60189a0071db36585cb444d729df3528e9ac6764977daa244157e5b0f065c6) ·
[pay 0.005](https://testnet.monadscan.com/tx/0x5815c1e01eb44c9318a263629b0aab3206f449c5d6417b28894839cf5f54d641).
Floor refusals (fund robot 2 with 50 and 14 MON) logged as `refused`, nothing sent.

**Receipt wait** (`npm run time:pay`, 5 sequential `pay()` calls, send accepted → receipt seen):

| Setting | min | avg | max |
|---|---|---|---|
| viem default (`waitForTransactionReceipt`, 4000 ms poll) | 538 ms | 693 ms | 954 ms |
| viem client `pollingInterval: 300` | 764 ms | 1159 ms | 1391 ms |
| **direct `eth_getTransactionReceipt` poll every 300 ms (kept)** | **188 ms** | **556 ms** | **775 ms** |

viem's wait checks once immediately, then only after a new block number, so lowering its interval didn't help;
polling the receipt directly does, and caps a missed first check at ~300 ms instead of ~4 s. Set in
`agents/config.json` → `network.receiptPollingMs`. The queue still waits for each receipt. End-to-end per tx
(simulate + estimate + fees + send + receipt) is ~2–3 s and dominated by RPC round-trips, not the receipt wait.

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
| P3 | 0.0564 MON gas (AGENT_1 0.0505, DEPLOYER 0.0060); 0.01 MON into robot 1, 0.01 MON paid out to the demo technician |
| P3 timing tweak | 0.1262 MON gas (AGENT_1: 3 × 5 timing/proof pays); 0.02 MON paid out from robot 1 to the demo technician |

## Open items

- MonaidCore v0 has no way to change a robot's agent after registration.
- Monadscan verification skipped (no `ETHERSCAN_API_KEY`); MonadVision is the verify target.
