import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@nomicfoundation/hardhat-ignition-viem";
import { config as loadEnv } from "dotenv";
import { join } from "path";

// All keys live in ONE file: agents/.env (git-ignored). Create wallets with `npm run wallet:new` in agents/.
loadEnv({ path: join(__dirname, "..", "agents", ".env"), quiet: true });

// Account order matters: [0] = DEPLOYER (owner), [1] = AGENT_1.
const ACCOUNTS = [process.env.DEPLOYER_PRIVATE_KEY, process.env.AGENT_1_PRIVATE_KEY].filter(
  (k): k is string => !!k
);
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const MONAD_TESTNET_RPC_URL = process.env.MONAD_RPC_URL || "https://testnet-rpc.monad.xyz";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.30",
    settings: {
      evmVersion: "osaka", // required for Monad
      optimizer: { enabled: true, runs: 200 },
      metadata: { bytecodeHash: "ipfs" }, // required for Sourcify verification
    },
  },
  networks: {
    monadTestnet: {
      url: MONAD_TESTNET_RPC_URL,
      accounts: ACCOUNTS,
      chainId: 10143,
    },
  },
  sourcify: {
    enabled: true,
    apiUrl: "https://sourcify-api-monad.blockvision.org",
    browserUrl: "https://testnet.monadvision.com",
  },
  etherscan: {
    enabled: true,
    apiKey: { monadTestnet: ETHERSCAN_API_KEY },
    customChains: [
      {
        network: "monadTestnet",
        chainId: 10143,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=10143",
          browserURL: "https://testnet.monadscan.com",
        },
      },
    ],
  },
};

export default config;
