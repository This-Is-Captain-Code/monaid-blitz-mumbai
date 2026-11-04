# Monaid — Status

_Last updated: 2026-11-04, end of step 1._

## Current step

**Step 2 — Broker** (Mosquitto config, per-device credentials, ACLs, ACL rejection test). Not started.

## Done

- [x] **Step 1 — MonaidCore v0** (register, fund, pay, pause). 6 tests passing, deployed, verified, `demo:pay` run.
  Branch `setup/monad-testnet` (pushed, PR not opened yet).

## Deployed (Monad testnet, chain 10143)

| Contract | Address | Notes |
|---|---|---|
| MonaidCore v0 | `0xDD22ee7923195EbBcC247d40553BCB138A6D5BBf` | [verified on MonadVision](https://testnet.monadvision.com/contracts/full_match/10143/0xDD22ee7923195EbBcC247d40553BCB138A6D5BBf/) · deploy tx [0x51f331c8…](https://testnet.monadscan.com/tx/0x51f331c895125db91a67994d4e23459c9655585ca64cd6d05906f7a645a771b0) · block 76858867 |

Machine-readable copy: `shared/addresses.json`.

## Wallets

Keys currently in `contracts/.env` (to move to `server/.env` when `server/` is created, step 3).

| Name | Address | Role | Balance (end of step 1) |
|---|---|---|---|
| DEPLOYER | `0x639B5bE0679EC82C7224F31d04bb3dD093222d5D` | owns MonaidCore, funds robots | 14.9237 MON |
| AGENT_1 | `0x31443AB8d8F13E16b86bfcDB4b965320E560824A` | robot 1's agent | 4.9872 MON |

Demo-only addresses (no keys): robot `0x478962782092A83697F4d5BC9c44bc1e5Ba572a6` (registered to AGENT_1 in v0,
0.005 MON in core), technician `0x9A5E9183193DA5978efc86e537604f1f787456D7` (received 0.005 MON).

## Findings

- **Reserve balance — gas-only agent wallets CAN sit below 10 MON.** AGENT_1 held 5 MON and its `pay` tx
  ([0xf37442bb…](https://testnet.monadscan.com/tx/0xf37442bb4a1f6e2ca6854589e797aa50702101a22187900cf39d28ad342cca96))
  succeeded: the reserve rule restricts value sent out of a wallet, not gas. Wallets that send value
  (DEPLOYER via `fund`) must stay above ~12 MON.
- **Gas limit = gas charged.** Monad receipts report `gasUsed` equal to the limit. Scripts estimate +15%.
  Typical fees at ~102–115 gwei: deploy ≈ 0.052 MON, `registerRobot` ≈ 0.006, `fund` ≈ 0.008, `pay` ≈ 0.013.
- Ignition deploys use the raw estimate as the limit (no margin); fine so far.

## MON spent

| Step | Spent |
|---|---|
| 1 | ≈ 0.079 MON gas + 0.01 MON sent into MonaidCore |

## Open items

- MonaidCore v0 has no way to change a robot's agent after registration.
- Monadscan verification skipped (no `ETHERSCAN_API_KEY`); MonadVision is the verify target per brief.
