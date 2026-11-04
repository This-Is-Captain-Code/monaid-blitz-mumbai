# Contracts (Monad testnet)

Hardhat 2 + viem, configured for **Monad Testnet** (chain ID `10143`, EVM target `osaka`).

| | |
|---|---|
| RPC | https://testnet-rpc.monad.xyz |
| Faucet | https://faucet.monad.xyz |
| Explorers | https://testnet.monadscan.com · https://testnet.monadvision.com |
| Currency | MON |

## Setup

```sh
cd contracts
npm install
```

Keys are read from **`agents/.env`** (the one place keys live). Create wallets there with
`npm run wallet:new -- <NAME>` in `agents/` — it prints addresses only and never overwrites a key.

1. Fund the printed addresses with testnet MON at https://faucet.monad.xyz.
2. `npm run balance` — shows DEPLOYER and AGENT_1 balances (full table: `npm run wallets` in `agents/`).

## Develop & deploy

```sh
npm run compile
npm test
npm run deploy:testnet                     # deploys ignition/modules/MonaidCore.ts
npm run verify:testnet -- <address>         # Sourcify/MonadVision; Monadscan needs ETHERSCAN_API_KEY
```

`MonaidCore.sol` (v0): `registerRobot`, `fund`, `pay`, `balanceOf`, `pause`/`unpause`. Add an Ignition module per deployment.

Notes: Hardhat 3 needs Node ≥ 22.13, so this uses Hardhat 2. `verify` sometimes prints an error even when verification succeeded — check the explorer.
