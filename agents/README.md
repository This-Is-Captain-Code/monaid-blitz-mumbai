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
