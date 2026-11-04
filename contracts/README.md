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
npm run wallet:new            # creates DEPLOYER + AGENT_1, keys go straight into .env
npm run wallet:new -- AGENT_2 # add another named wallet
```

`wallet:new` prints addresses only and never overwrites an existing key. `.env` is git-ignored — never commit it.

1. Fund the printed addresses with testnet MON at https://faucet.monad.xyz.
2. `npm run balance` — shows every wallet and its MON balance.

## Develop & deploy

```sh
npm run compile
npm test
npm run deploy:testnet                     # deploys ignition/modules/Greeter.ts
npm run verify:testnet -- <address> "gm Monad"   # needs ETHERSCAN_API_KEY for Monadscan
```

`Greeter.sol` is a placeholder to prove the pipeline — replace it with the project's contracts and add an Ignition module per deployment.

Notes: Hardhat 3 needs Node ≥ 22.13, so this uses Hardhat 2. `verify` sometimes prints an error even when verification succeeded — check the explorer.
