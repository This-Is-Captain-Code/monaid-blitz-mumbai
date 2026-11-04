// Worker registry: short worker ID → wallet address (agents/workers.json).
// Claims carry only the worker ID; the address always comes from this file, never from the request.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAddress, isAddress, type Address } from "viem";
import { AGENTS_DIR } from "./env.js";
import { config } from "./chain.js";

const ID_RE = /^[a-z0-9_-]{1,32}$/;
const FILE = join(AGENTS_DIR, (config as { workersFile?: string }).workersFile ?? "workers.json");

export class UnknownWorkerError extends Error {
  constructor(public readonly workerId: string) {
    super(`Unknown worker "${workerId}"`);
    this.name = "UnknownWorkerError";
  }
}

let cache: Map<string, Address> | undefined;

export function loadWorkers(): Map<string, Address> {
  const raw = JSON.parse(readFileSync(FILE, "utf8")) as { workers: Record<string, string> };
  const m = new Map<string, Address>();
  for (const [id, addr] of Object.entries(raw.workers ?? {})) {
    if (!ID_RE.test(id)) throw new Error(`workers.json: bad worker id "${id}"`);
    if (!isAddress(addr)) throw new Error(`workers.json: bad address for "${id}"`);
    m.set(id, getAddress(addr));
  }
  cache = m;
  return m;
}

export const workers = () => cache ?? loadWorkers();

/** Worker ID → address, or throws UnknownWorkerError. */
export function resolveWorker(workerId: unknown): { id: string; address: Address } {
  const id = typeof workerId === "string" ? workerId.trim() : "";
  const address = ID_RE.test(id) ? workers().get(id) : undefined;
  if (!address) throw new UnknownWorkerError(String(workerId).slice(0, 40));
  return { id, address };
}

/** Address → worker ID (for display), if registered. */
export const workerIdOf = (address?: string) =>
  address ? [...workers()].find(([, a]) => a.toLowerCase() === address.toLowerCase())?.[0] : undefined;
