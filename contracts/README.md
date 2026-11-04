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
cp .env.example .env
npm run wallet:new        # prints a fresh address + private key
```

1. Put the private key in `.env` as `PRIVATE_KEY=0x...` (never commit `.env`).
2. Claim testnet MON for the address at https://faucet.monad.xyz.
3. `npm run balance` — confirms the key is loaded and shows the MON balance.

## Develop & deploy

```sh
npm run compile
npm test
npm run deploy:testnet                     # deploys ignition/modules/Greeter.ts
npm run verify:testnet -- <address> "gm Monad"   # needs ETHERSCAN_API_KEY for Monadscan
```

`Greeter.sol` is a placeholder to prove the pipeline — replace it with the project's contracts and add an Ignition module per deployment.

Notes: Hardhat 3 needs Node ≥ 22.13, so this uses Hardhat 2. `verify` sometimes prints an error even when verification succeeded — check the explorer.
