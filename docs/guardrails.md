# Monaid guardrails

Two layers. **On-chain (MonaidCore) is the real one**: it holds even if our server is wrong or compromised.
**Off-chain (agents/) is a second layer**: it stops bad actions earlier, for free (nothing sent, no gas), and
adds rules the chain doesn't know about (daily budgets, owner approval). The off-chain layer is never the only check.

## Summary

| # | Guardrail | Layer | Where | Blocks with | Demo beat |
|---|---|---|---|---|---|
| 1 | Per-job max payout (chain) | on-chain | `MonaidCore.maxPayout` (owner-set, 0.1 MON) | `PayoutTooHigh(payout, max)` | `demo:guardrails` case "on-chain cap" — explorer link |
| 2 | Payout escrowed at post | on-chain | `postJob` moves payout from balance to `escrowOf` | `InsufficientBalance(available, requested)` | contract test |
| 3 | Only the robot's agent posts / claims / settles / cancels | on-chain | `_onlyAgentOf` | `NotRobotAgent` | contract test |
| 4 | Claims expire; anyone can expire | on-chain | `claim` deadline, `expire` | `ClaimExpired`, `ClaimNotExpired` | `check:agent` case C; contract test |
| 5 | Owner pause (on-chain kill switch) | on-chain | `pause()` | `Paused` on fund / pay / postJob / claim / settle (cancel + expire still work) | contract test |
| 6 | Per-job max payout (policy) | off-chain | `agents/policy.json` `maxPayoutPerJob` | `PAYOUT_ABOVE_POLICY` | `demo:guardrails` "policy cap" |
| 7 | Daily spend cap per robot | off-chain | `maxSpendPerDay`, ledger `agents/logs/spend.jsonl` | `DAILY_CAP` | `demo:guardrails` "daily cap" |
| 8 | Max open jobs per robot | off-chain | `maxOpenJobs` | `TOO_MANY_OPEN_JOBS` | `demo:guardrails` "max open jobs" |
| 9 | Allowed actions per robot | off-chain | `allowedActions` | `ACTION_NOT_ALLOWED` | `demo:guardrails` "action not allowed" |
| 10 | Owner approval above a threshold | off-chain | `ownerApprovalAbove` (0.02 MON) → approval queue | waits as `pending_approval` until approve / reject | `demo:guardrails` "owner approval"; `check:agent` case A |
| 11 | Global kill switch (ours) | off-chain | `MONAID_KILL=1` or `engageKillSwitch()` (P6: `POST /admin/kill`) | `KILL_SWITCH` — **every** send, agents and DEPLOYER | `demo:guardrails` "kill switch" |
| 12 | DEPLOYER hard floor 12 MON | off-chain | `sendTx` on every DEPLOYER value send | `Refused: … can still spend X MON` | `check:refusals` |
| 13 | Agent gas top-ups capped per day | off-chain | `topup:agents`, 10 MON/day | skipped with a message | `topup:agents --dry-run` |
| 14 | Muse chooses only among our options | off-chain | P7 | invalid / slow → owner decides | P7 |
| 15 | Device/worker/message data is untrusted input | off-chain | `RobotAgent` validates addresses, records proofs as data | `Invalid worker address` | — |

## How the off-chain check runs

Every `RobotAgent` action (`postJob`, `acceptClaim`, `settleOnProof`, `expire`, `cancel`) runs, in order:

1. **Kill switch** — engaged → `KILL_SWITCH`.
2. **Policy** (`evaluate()` in `agents/src/policy.ts`, pure and unit-tested):
   allowed action → payout ≤ `maxPayoutPerJob` → today's spend + payout ≤ `maxSpendPerDay` → open jobs < `maxOpenJobs`
   → payout ≤ `ownerApprovalAbove` (else **wait for the owner**).
3. **sendTx** — kill switch again, DEPLOYER floor, gas, and the simulation, which applies **MonaidCore's own rules
   before anything is sent** (a bad call is refused locally with the contract's error name, no gas).
4. **On-chain** — the contract enforces its rules regardless.

Blocked actions are written to `agents/logs/audit.jsonl` (`result: "blocked"`, with `code` and the reason) and
emitted on the feed (P6 streams it to screens and the portal). Approvals are emitted too.

**Daily spend** counts a job's payout when it is posted and credits it back if the job is cancelled or expires
(that MON never left the robot). Days are UTC.

**Owner approval** re-checks every other rule and the kill switch at the moment the owner approves, so an approval
can't be used to get around a cap that was hit in the meantime.

## Policy file

`agents/policy.json` — `defaults` plus per-robot overrides (MON amounts as strings):

```json
{
  "defaults": {
    "maxPayoutPerJob": "0.05",
    "maxSpendPerDay": "0.1",
    "maxOpenJobs": 2,
    "ownerApprovalAbove": "0.02",
    "allowedActions": ["postJob", "claim", "settle", "expire", "cancel"]
  },
  "robots": { "1": {}, "2": {} }
}
```

Keep `maxPayoutPerJob` ≤ the on-chain `maxPayout` (0.1 MON) and `ownerApprovalAbove` below both.

## How to show them

```sh
cd agents
npm run demo:guardrails   # 9 one-line beats: policy cap, approval, allowed job, daily cap, open jobs,
                          # action not allowed, kill switch (agent + DEPLOYER), on-chain revert with explorer link
npm run check:agent       # owner approves a queued job; happy path; fail path (claim → window → expire)
npm run check:refusals    # contract revert caught before sending; DEPLOYER floor refusal
npm test                  # policy rules offline
cd ../contracts && npm test   # every on-chain revert
```

`demo:guardrails` uses a tighter demo policy (daily cap 0.03 MON, 1 open job) so every cap is reachable with
tiny amounts; it costs ~0.045 MON of AGENT_1 gas and cleans up its job.

Sample output (2026-11-04):

```
✔ policy cap             Blocked (PAYOUT_ABOVE_POLICY): payout 0.08 MON > robot 1 maxPayoutPerJob 0.05 MON  — off-chain, nothing sent
✔ owner approval         postJob 0.03 MON > 0.02 threshold → queued as approval 0bf52125, owner rejected — nothing sent
✔ allowed job            postJob 0.02 MON → job 3 posted https://testnet.monadscan.com/tx/0x1dc58043…
✔ daily cap              Blocked (DAILY_CAP): robot 1 spent 0.02 MON today; +0.02 MON > maxSpendPerDay 0.03 MON  — off-chain, nothing sent
✔ max open jobs          Blocked (TOO_MANY_OPEN_JOBS): robot 1 has 1 open jobs (max 1)  — off-chain, nothing sent
✔ action not allowed     Blocked (ACTION_NOT_ALLOWED): settle is not allowed for robot 1  — off-chain, nothing sent
✔ kill switch (agent)    Blocked (KILL_SWITCH): Kill switch engaged (guardrails demo): no transactions are sent  — off-chain, nothing sent
✔ kill switch (deployer) Kill switch engaged (guardrails demo): no transactions are sent  — off-chain, nothing sent
✔ on-chain cap           policy skipped, postJob 0.2 MON → MonaidCore reverted PayoutTooHigh(200000000000000000, 100000000000000000) https://testnet.monadscan.com/tx/0xc4b3ff22…
```

## What the kill switches do

- **Ours** (`MONAID_KILL=1`, `engageKillSwitch()`, later `POST /admin/kill`) stops every transaction our server would
  send. Instant, free, reversible. Does not stop anyone else.
- **On-chain** (`MonaidCore.pause()`, owner = DEPLOYER) stops fund / pay / postJob / claim / settle for everyone.
  `cancel` and `expire` still work so escrow can always go back to the robot.
