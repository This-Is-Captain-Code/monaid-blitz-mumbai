# agents/

TypeScript + viem. Wallets, funding, (later) tx sender, robot agents, Muse, guardrails, Agents API.

**Keys:** all private keys live in `agents/.env` (git-ignored). `contracts/` reads them from here too.
Keys are created by script and never printed — only addresses.

```sh
cd agents
npm install
npm run wallet:new -- <NAME>       # e.g. AGENT_3 — key into .env, prints address, refuses to overwrite
npm run wallets                    # name, address, role, balance, floor, spendable, explorer link + robots in MonaidCore
npm run register:robots            # DEPLOYER registers every robot in config.json (idempotent, gas only)
npm run fund:robot -- <id> <MON>   # DEPLOYER funds a robot inside MonaidCore
npm run topup:agents [-- --dry-run]  # refill agent gas wallets below floor, within daily cap
```

## Funding rules (`config.json` → `funding`)

| Rule | Value | Why |
|---|---|---|
| DEPLOYER hard floor | 12 MON | Monad's reserve rule blocks value sends that leave < 10 MON. Every DEPLOYER value send checks this first and refuses with how much it can still spend. |
| Agent gas floor | 1 MON | Tested: gas-only wallets can sit below 10 MON (see docs/STATUS.md). |
| Agent top-up target | 3 MON | Agents below the floor are refilled to this. |
| Top-up daily cap | 10 MON / UTC day | Ledger in `agents/logs/topups.jsonl`. |

"Spendable" in `npm run wallets` = balance − floor.

## Robots (`config.json` → `robots`)

Robot ids map to wallets `AGENT_<id>`. Robots hold no keys; the on-chain robot address is derived from the id
(`keccak256("monaid:robot:<id>")`, last 20 bytes). Addresses are mirrored in `shared/addresses.json`.

## Sending transactions — `src/tx.ts`

Every transaction goes through `sendTx({ wallet, action, to, abi, functionName, args, value, robot, reason })`:

1. DEPLOYER value sends: hard-floor check first (refuses with what is still spendable).
2. Simulate (`eth_call`) — a revert stops here, decoded to a custom error name, **nothing sent, no gas**.
3. Estimate gas + 15% (Monad charges the gas limit).
4. Sign locally with a tracked nonce, send, wait for the receipt → `{ hash, link, nonce, gas, fee, receipt }`.

- **Per-wallet serial queue:** sends from one wallet never overlap; nonces are tracked locally (resync on "nonce too low").
- **Retries:** network errors only (HTTP/timeout/429/5xx), up to 3×, resending the *same* signed tx — never reverts.
- **Errors:** `TxRevertedError` (`.errorName`, `.errorArgs`, `.stage` = simulate | estimate | onchain), `FloorError`.
- **Audit:** one JSON line per attempt in `agents/logs/audit.jsonl`
  (time, robot, wallet, action, args, value, reason, result = success | reverted | refused | error, hash, link, fee).

```sh
npm run demo:pay [-- <robotId> <MON>]   # fund robot (DEPLOYER) + agent pays the demo technician
npm run proof:sendtx                    # 5 concurrent pays from one agent → consecutive nonces, in order; decoded revert
npm test                                # offline: revert decoding, network-vs-revert classification
```

## Robot agents and guardrails (P5)

`src/robot-agent.ts` — one `RobotAgent` per robot, owning `AGENT_<id>`:
`postJob({ payout, claimWindow, reason })`, `acceptClaim(jobId, worker)`, `settleOnProof(jobId, proof)`, `expire(jobId)`,
`cancel(jobId)`, `jobs()`, `refreshJob(jobId)`, `status()`. All sends go through `sendTx`.

- `policy.json` — per-robot off-chain policy (`src/policy.ts`, pure `evaluate()`).
- `src/approvals.ts` — owner-approval queue (`requestApproval`, `listApprovals`, `approve`, `reject`).
- `src/killswitch.ts` — global kill switch (`MONAID_KILL=1`, `engageKillSwitch()`, `releaseKillSwitch()`), enforced in `sendTx`.
- `src/ledger.ts` — daily spend (`logs/spend.jsonl`) and job records (`logs/jobs.json`).
- `src/bus.ts` — in-process feed events (P6 streams them over SSE).

```sh
npm run demo:guardrails   # each guardrail blocking something, one line per case
npm run check:agent       # approval → approve; happy path; fail path (expire)
```

Full table and how to demo each one: `docs/guardrails.md`.
