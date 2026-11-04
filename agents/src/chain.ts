// Chain access: clients, MonaidCore binding, config, robot ids → on-chain robot addresses.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  keccak256,
  parseEther,
  slice,
  toHex,
  type Abi,
  type Address,
} from "viem";
import { AGENTS_DIR, account, readEnv } from "./env.js";

const SHARED = join(AGENTS_DIR, "..", "shared");

export const config = JSON.parse(readFileSync(join(AGENTS_DIR, "config.json"), "utf8")) as {
  network: { name: string; chainId: number; rpcUrl: string; txExplorer: string; addressExplorer: string };
  robots: { id: string; agent: string }[];
  funding: { deployerFloorMon: string; agentGasFloorMon: string; agentTopupTargetMon: string; agentTopupDailyCapMon: string };
};

export const FLOORS = {
  deployer: parseEther(config.funding.deployerFloorMon),
  agentGas: parseEther(config.funding.agentGasFloorMon),
  agentTarget: parseEther(config.funding.agentTopupTargetMon),
  agentDailyCap: parseEther(config.funding.agentTopupDailyCapMon),
};

export const monadTestnet = defineChain({
  id: config.network.chainId,
  name: config.network.name,
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [readEnv().MONAD_RPC_URL || config.network.rpcUrl] } },
});

/** How often waitForTransactionReceipt polls. undefined = viem's default. */
export const RECEIPT_POLL_MS: number | undefined = (config.network as { receiptPollingMs?: number }).receiptPollingMs;

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(),
  ...(RECEIPT_POLL_MS ? { pollingInterval: RECEIPT_POLL_MS } : {}),
});
export const walletClient = (name: string) =>
  createWalletClient({ chain: monadTestnet, transport: http(), account: account(name) });

export const txLink = (hash: string) => `${config.network.txExplorer}${hash}`;
export const addressLink = (addr: string) => `${config.network.addressExplorer}${addr}`;

const addresses = JSON.parse(readFileSync(join(SHARED, "addresses.json"), "utf8"));
export const CORE_ADDRESS = getAddress(addresses.monadTestnet.MonaidCore.address) as Address;
export const CORE_ABI = JSON.parse(readFileSync(join(SHARED, "abi", "MonaidCore.json"), "utf8")) as Abi;

/** Robots have no keys; their on-chain id is an address derived from the robot id. */
export const robotAddress = (robotId: string): Address => getAddress(slice(keccak256(toHex(`monaid:robot:${robotId}`)), 12));

export function robotConfig(robotId: string) {
  const r = config.robots.find((x) => x.id === robotId);
  if (!r) throw new Error(`Unknown robot "${robotId}". Known: ${config.robots.map((x) => x.id).join(", ")}`);
  return { ...r, address: robotAddress(r.id) };
}

/** Wallet role, from its name. */
export function roleOf(name: string): string {
  if (name === "DEPLOYER") return "owner / funder";
  const r = config.robots.find((x) => x.agent === name);
  return r ? `agent, robot ${r.id}` : "unassigned";
}

/** Balance a wallet must keep. DEPLOYER: hard floor (sends value). Agents: gas floor. */
export const floorOf = (name: string) => (name === "DEPLOYER" ? FLOORS.deployer : FLOORS.agentGas);
