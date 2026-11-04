// Chain access: clients, MonaidCore binding, config, robot ids → on-chain robot addresses.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  fallback,
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
  network: { name: string; chainId: number; rpcUrl: string; backupRpcUrl?: string; txExplorer: string; addressExplorer: string };
  robots: { id: string; agent: string; bridgeId?: number; addressId?: string; label?: string }[];
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

/** Primary RPC, then the backup (Ankr) if the primary fails — the venue network drops requests to the primary. */
function rpcTransport() {
  const primary = http(readEnv().MONAD_RPC_URL || config.network.rpcUrl, { retryCount: 1, timeout: 8_000 });
  return config.network.backupRpcUrl ? fallback([primary, http(config.network.backupRpcUrl, { retryCount: 1, timeout: 8_000 })]) : primary;
}

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: rpcTransport(),
  ...(RECEIPT_POLL_MS ? { pollingInterval: RECEIPT_POLL_MS } : {}),
});
export const walletClient = (name: string) =>
  createWalletClient({ chain: monadTestnet, transport: rpcTransport(), account: account(name) });

export const txLink = (hash: string) => `${config.network.txExplorer}${hash}`;
export const addressLink = (addr: string) => `${config.network.addressExplorer}${addr}`;

const addresses = JSON.parse(readFileSync(join(SHARED, "addresses.json"), "utf8"));
export const CORE_ADDRESS = getAddress(addresses.monadTestnet.MonaidCore.address) as Address;
export const CORE_ABI = JSON.parse(readFileSync(join(SHARED, "abi", "MonaidCore.json"), "utf8")) as Abi;

/** Robots have no keys; their on-chain id is derived from `addressId` (default: the robot id). */
export const robotAddress = (robotId: string): Address => {
  const seed = config.robots.find((x) => x.id === robotId)?.addressId ?? robotId;
  return getAddress(slice(keccak256(toHex(`monaid:robot:${seed}`)), 12));
};

export function robotConfig(robotId: string) {
  const r = config.robots.find((x) => x.id === robotId);
  if (!r) throw new Error(`Unknown robot "${robotId}". Known: ${config.robots.map((x) => x.id).join(", ")}`);
  return { ...r, address: robotAddress(r.id) };
}

/** Wallet role, from its name. */
export function roleOf(name: string): string {
  if (name === "DEPLOYER") return "owner / funder";
  if (name.startsWith("WORKER_")) return "demo worker";
  const r = config.robots.find((x) => x.agent === name);
  return r ? `agent, robot ${r.id}` : "unassigned";
}

/** Balance a wallet must keep. DEPLOYER: hard floor (sends value). Agents: gas floor. */
export const floorOf = (name: string) =>
  name === "DEPLOYER" ? FLOORS.deployer : name.startsWith("WORKER_") ? 0n : FLOORS.agentGas; // workers: no floor

/** Base URL of the Agents API for scripts: MONAID_API_URL (e.g. the public Render URL) or the local config. */
export function apiBase(): string {
  if (process.env.MONAID_API_URL) return process.env.MONAID_API_URL.replace(/\/+$/, "");
  const a = (config as unknown as { api: { host: string; port: number } }).api;
  const host = process.env.MONAID_API_HOST || a.host;
  return `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${process.env.MONAID_API_PORT || a.port}`;
}
