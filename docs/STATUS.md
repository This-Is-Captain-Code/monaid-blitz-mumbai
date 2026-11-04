# Monaid — Status

_Last updated: 2026-11-04, end of P5; next P6._

**My scope:** `contracts/`, `agents/`, `shared/`, `docs/` only — wallets, funding, transactions, robot agents,
Muse logic, guardrails, and an API for teammates. Firmware, broker, MQTT bridge, screens, portal UI and
WhatsApp transport belong to teammates.

## Plan

| Step | Title | Status |
|---|---|---|
| P0 | Stop and re-scope | done |
| P1 | Finish the payment contract (MonaidCore v0) | done and merged (PR #1, #2) |
| P2 | Wallet manager and funding | done and merged (PR #2) |
| P3 | Transaction sender | done and merged (PR #3) |
| P4 | Jobs in the contract (MonaidCore v1.1) + sendTx latency pass | done and merged (PR #4) |
| P5 | Robot agents and off-chain guardrails | **done** — branch `step5/agents` (not merged) |
| P6 | Agents API for teammates | **next** |
| P7 | Muse (decision logic only) | — |
| P8 | Module contract (Charger / Lost / Down, team picks) | — |
| P9 | Demo hardening | — |

### Pending

- **Hotspot timing of a full settle (5 before / 5 after) — skipped for now, pending.** Run on the phone hotspot:
  `MONAID_TX_LEGACY=1 npm run time:settle` (before) and `npm run time:settle` (after) in `agents/`. ~0.37 MON of AGENT_1 gas.
  Indicative only (venue Wi-Fi, current path before fixed gas, 3 runs): settle 975 / 1417 / 1468 ms.

## Broker — handed to teammate

Local `broker/` kept as-is, excluded via `.git/info/exclude`. Mosquitto 2.1.2 installed on the laptop; service untouched.

## Deployed (Monad testnet, chain 10143)

| Contract | Address | Notes |
|---|---|---|
| **MonaidCore v1.1** (current) | `0x3DbE227ad91Cc3bfa14468196F413173dF893867` | [verified on MonadVision](https://testnet.monadvision.com/contracts/full_match/10143/0x3DbE227ad91Cc3bfa14468196F413173dF893867/) · deploy tx [0xcc5c76c5…](https://testnet.monadscan.com/tx/0xcc5c76c55a923615285d22bad1a4f8da43f356cfcb1ca02f0ab2a22a1572f1b6) · block 76879068 · maxPayout 0.1 MON |
| MonaidCore v1 (retired) | `0xb95e667d8DA354a0517553926D39Af148543Ce98` | balances recovered; its maxPayout was raised to 0.5 MON for the recovery |
| MonaidCore v0 (retired) | `0xDD22ee7923195EbBcC247d40553BCB138A6D5BBf` | balances recovered |

Machine-readable: `shared/addresses.json` (current + `history`) and `shared/abi/MonaidCore.json`.

### MonaidCore v1.1 rules

- `postJob(robot, payout, claimWindow)` — robot's agent only; `payout ≤ maxPayout`; payout escrowed from the robot's balance.
- `claim(jobId, worker)` — robot's agent only (the bridge/portal reports claims to our API); claim valid for `claimWindow` seconds.
- `settle(jobId)` — robot's agent only; pays the worker; reverts `JobNotClaimed` / `ClaimExpired` / `AlreadySettled`.
- `expire(jobId)` — **anyone**, after the window; escrow back to the robot. **Works while paused.**
- `cancel(jobId)` — robot's agent, unclaimed jobs only; escrow back. **Works while paused.**
- `pay(robot, to, amount)` — direct agent payment, capped by `maxPayout`.
- `pause()` blocks `fund`, `pay`, `postJob`, `claim`, `settle`. `setMaxPayout` owner only.
- Errors: `NotOwner`, `NotRobotAgent`, `RobotNotRegistered`, `RobotAlreadyRegistered`, `ZeroAddress`, `ZeroAmount`, `ZeroWindow`,
  `InsufficientBalance`, `PayoutTooHigh`, `Paused`, `TransferFailed`, `UseFund`, `JobNotFound`, `JobNotOpen`, `JobNotClaimed`,
  `ClaimExpired`, `ClaimNotExpired`, `AlreadySettled`. 12 contract tests.

## Wallets

All keys in `agents/.env` (git-ignored); `contracts/` reads from it. Funding rules (`agents/config.json`): DEPLOYER hard floor
**12 MON**; agent gas floor **1 MON**, top-up target **3 MON**, top-ups capped at **10 MON per UTC day**.

| Name | Address | Role | Balance (end of P5) | Spendable |
|---|---|---|---|---|
| DEPLOYER | `0x639B5bE0679EC82C7224F31d04bb3dD093222d5D` | owner / funder | 25.5257 MON | 13.5257 MON |
| AGENT_1 | `0x31443AB8d8F13E16b86bfcDB4b965320E560824A` | agent, robot 1 | 4.5273 MON | 3.5273 MON |
| AGENT_2 | `0x16Cd0840ba8d68B526D5F5D9EB72626bB7A1CA45` | agent, robot 2 | 2.8919 MON | 1.8919 MON |

| Robot | Robot address (derived from id, no key) | Agent | Balance in v1.1 |
|---|---|---|---|
| 1 | `0xB46d4FeCEFd31C1531FA84Dd61228b9Ea5107077` | AGENT_1 | 0.5 MON |
| 2 | `0xE1f9bf1554a484d8993bF19e4cF02B79e4ccF254` | AGENT_2 | 0.499 MON |

## sendTx (`agents/src/tx.ts`)

DEPLOYER floor check → gas (fixed per action, or estimate +15%; estimation doubles as the revert pre-check) →
sign with local nonce + cached fees → send → poll receipt every 300 ms. Per-wallet serial queue; network-error
retries only; custom errors decoded; one audit line per attempt in `agents/logs/audit.jsonl`.

- **Fee cache:** refreshed in the background every 3 s (`tx.feeRefreshMs`).
- **Fixed gas** (`tx.fixedGas`, measured via `eth_estimateGas` on v1, +5%): postJob 174,700 (max seen 166,377 on a
  contract's first job), claim 55,900 (53,165), settle 114,100 (108,634, paying a fresh worker address).
  Fixed-gas actions still simulate first, **with the fixed limit**, so bad calls are refused locally (your choice).
- **Out-of-gas fallback:** a too-small fixed limit is logged (`result: "out-of-gas"`) and retried once with estimation.
  Proven live (`npm run check:oog`): caught at preflight with nothing sent; and, with preflight off, failed on-chain
  ([0xa77108b0…](https://testnet.monadscan.com/tx/0xa77108b04f9b7639213417382be23369ab95c960889191d229145f13234ee058),
  0.00612 MON) then succeeded on the retry.
- `MONAID_TX_LEGACY=1` reproduces the pre-latency-pass path for timing comparisons.

### Earlier timings (venue Wi-Fi)

| Receipt wait, 5 sequential `pay()` (send → receipt) | min | avg | max |
|---|---|---|---|
| viem default (`waitForTransactionReceipt`, 4000 ms poll) | 538 ms | 693 ms | 954 ms |
| viem client `pollingInterval: 300` | 764 ms | 1159 ms | 1391 ms |
| **direct receipt poll every 300 ms (kept)** | **188 ms** | **556 ms** | **775 ms** |

Nonce proof (`npm run proof:sendtx`): 5 concurrent pays from one agent → consecutive nonces, chain order = nonce order.

## Robot agents and guardrails (P5)

`RobotAgent` per robot (`agents/src/robot-agent.ts`): postJob, acceptClaim, settleOnProof, expire, cancel — via sendTx,
after the off-chain checks: kill switch → policy (`agents/policy.json`: maxPayoutPerJob 0.05, maxSpendPerDay 0.1,
maxOpenJobs 2, ownerApprovalAbove 0.02 MON, allowedActions) → owner-approval queue above the threshold.
Kill switch (`MONAID_KILL=1` / `engageKillSwitch()`) is enforced inside sendTx, so it stops every send.
Full table and demo instructions: `docs/guardrails.md`.

- `npm run demo:guardrails` — 9/9 beats: policy cap, owner approval, allowed job, daily cap, max open jobs,
  action not allowed, kill switch (agent + DEPLOYER), on-chain `PayoutTooHigh` revert
  ([0xc4b3ff22…](https://testnet.monadscan.com/tx/0xc4b3ff224fec1cb6b9391af680c556da41c16e08ae7334b2e201a2eabd5d98d2)).
- `npm run check:agent` (robot 2) — approval → approve → posted → cancel; happy path job 5
  ([settle](https://testnet.monadscan.com/tx/0xb14e7e2504a93e3e39f2df75abb640eee972af5a378cca6877c423e89d2760d0));
  fail path job 6 ([expire](https://testnet.monadscan.com/tx/0x1f80103523e1ae559605fdb719727c447555a48b9924fc651844ef9699c3d52d)).
  A real network error mid-send was retried with the same signed tx and succeeded.
- Agents unit tests: 10 (sendTx error handling + policy rules).

## Findings

- **Reserve balance — gas-only wallets CAN sit below 10 MON** (AGENT_1 self-tx at 4.99 MON succeeded,
  [0x49cfba7a…](https://testnet.monadscan.com/tx/0x49cfba7a8c66bd4a150f5de63583351cf45056453f046771a0b1e9da9fe0a580)).
  Only value sends are restricted. Agent gas floor 1 MON; DEPLOYER ≥ 12 MON.
- **Gas limit = gas charged**, and Monad receipts report `gasUsed` = the limit, so real usage must come from `eth_estimateGas`.
- Fees at ~102 gwei: deploy v1.1 ≈ 0.137 MON, `registerRobot` ≈ 0.0062, `fund` ≈ 0.0081, `pay` ≈ 0.0084, transfer ≈ 0.0025.

## P4 transactions

| What | Tx |
|---|---|
| v0 → DEPLOYER recovery (robot 1, 2, P1 demo robot) | [0xccaea64a…](https://testnet.monadscan.com/tx/0xccaea64a32b5b0959f478e1c226dcd4e404b9b0cf767ec20e75fb06acebdc297) · [0xaa36c0f6…](https://testnet.monadscan.com/tx/0xaa36c0f662182c4a2189a0ecf073fc8237379929d30cb76d0e0d3be003b8f3e2) · [0x9d77737e…](https://testnet.monadscan.com/tx/0x9d77737e42e5db8684b0fd665a554dca91f66d248e2ed3441f534b52eae87025) |
| Deploy v1 | [0x2535b067…](https://testnet.monadscan.com/tx/0x2535b067ade056ec0c196005359e04967b4699c1cf23917dddb52eb12808ea5c) |
| v1 register 1, 2 · fund 1, 2 | [0x321a5500…](https://testnet.monadscan.com/tx/0x321a55003aa848f5016059e18c86edd9fad056a04342405e9aef44d250441084) · [0x7cf068ad…](https://testnet.monadscan.com/tx/0x7cf068ad6c2718f33477151fad7ac5776009c5e7c4fc4ebea38dbfb0da174ad2) · [0x86936906…](https://testnet.monadscan.com/tx/0x86936906fce322bfc233386440838dd3d4d6f0e5dc3451c5cb4746d650bf4dfb) · [0xa969a7ef…](https://testnet.monadscan.com/tx/0xa969a7ef4631be2ab91915ac4e3a951ec6e333d37932d1db2998e4416b4f21ce) |
| Gas measurement: 3 × postJob/claim/settle on v1 | settles [run 1](https://testnet.monadscan.com/tx/0x7af374e2ab25d10b5925231bd76db10c9ea1d86637a0452a6cff41bc6f60e8d6) · [run 2](https://testnet.monadscan.com/tx/0x7b2df763c93310b7089e713d792cc6cd305a7df2d008508514ecc5273d0fb276) · [run 3](https://testnet.monadscan.com/tx/0xdbdcdf96ba392a50c9a55ac3c57b9a876f917a233667e8c9658a08f746be1ea2) |
| v1 → DEPLOYER recovery (setMaxPayout 0.5, robot 1, robot 2) | [0x0ae231f6…](https://testnet.monadscan.com/tx/0x0ae231f6556e747b1b17d1a31a8bfb1d11313f1d0e9cc2044be31e9316aa2aba) · [0x52006024…](https://testnet.monadscan.com/tx/0x52006024f822a051aea5efd297680d0f59d854a92d54b47514a41dc912226556) · [0xe433c7bb…](https://testnet.monadscan.com/tx/0xe433c7bbc9395f132490976e5c3c73e2feb735d1b750296ea9a5e9cee9512cb5) |
| Deploy v1.1 | [0xcc5c76c5…](https://testnet.monadscan.com/tx/0xcc5c76c55a923615285d22bad1a4f8da43f356cfcb1ca02f0ab2a22a1572f1b6) |
| v1.1 register 1, 2 · fund 1, 2 | [0xb06b1eb0…](https://testnet.monadscan.com/tx/0xb06b1eb0a09756c3f58859f50ce63039f697377517157dc3ae61cc86227027d2) · [0x716c8889…](https://testnet.monadscan.com/tx/0x716c8889eebca00d1b02d35a5c4c8c8d12e6aa73beb4f21dc4bea7ff8b67c01c) · [0x2e48f93d…](https://testnet.monadscan.com/tx/0x2e48f93d1866a1703f74de2ebffcd1a83e6b1c61695c14f2fba36ccd8ef6ecf7) · [0xa27ad4be…](https://testnet.monadscan.com/tx/0xa27ad4be52670b614e57c9c5af44846a2e482fd20a127ef33104fe1d14c06392) |
| check:oog (postJob ×2 after fallback, 1 failed on-chain attempt, cancel ×2) | [0x0946a9c5…](https://testnet.monadscan.com/tx/0x0946a9c5a8650b094c3498c7336477ecb058bb6e3dc2be350301c41215d8e7e6) · [0xa77108b0…](https://testnet.monadscan.com/tx/0xa77108b04f9b7639213417382be23369ab95c960889191d229145f13234ee058) · [0xdaacb031…](https://testnet.monadscan.com/tx/0xdaacb0313b26a126b20112429080b63aa2404392383d1fa3aab950652348b860) |

## MON spent

| Step | Spent |
|---|---|
| P1 | ≈ 0.079 MON gas + 0.01 MON into MonaidCore v0 |
| P1 leftovers | 0.0025 MON |
| P2 | 0.0311 MON gas; 3 MON DEPLOYER → AGENT_2, 1 MON into v0. You added 15 MON to DEPLOYER. |
| P3 | 0.0564 MON gas |
| P3 timing tweak | 0.1683 MON gas |
| P5 | 0.1347 MON gas (AGENT_1 0.0435 guardrails demo, AGENT_2 0.0912 check:agent); 0.001 MON paid from robot 2 to a test worker |
| P4 | ≈ 0.53 MON gas in total (two deploys ≈ 0.275, recoveries ≈ 0.046, registers/funds ≈ 0.041, gas measurement 0.111, check:oog ≈ 0.059). 1.985 MON recovered from v0/v1; 1 MON now in v1.1. |

## Open items

- Hotspot settle timing (see Pending).
- Robot ids may change to match teammates' MQTT usernames (`agents/config.json` → `robots`); re-register if they do.
- Monadscan verification skipped (no `ETHERSCAN_API_KEY`); MonadVision is the verify target.
