// The ONE path every transaction takes:
//   simulate (eth_call) → estimate gas +15% → sign → send → wait for receipt → hash + explorer link.
// - Per-wallet serial queue with local nonce tracking: never two sends in flight from one wallet.
// - Retries network errors only (same signed tx, so a retry can't double-send). Reverts are never retried.
// - Custom errors are decoded to readable names (e.g. InsufficientBalance(available, requested)).
// - Every attempt appends one line to agents/logs/audit.jsonl.
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  BaseError,
  HttpRequestError,
  TimeoutError,
  decodeErrorResult,
  encodeFunctionData,
  formatEther,
  keccak256,
  type Abi,
  type Address,
  type Hash,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { AGENTS_DIR } from "./env.js";
import { CORE_ABI, publicClient, txLink, walletClient } from "./chain.js";
import { FloorError, assertDeployerCanSpend } from "./funding.js";

const audited = new WeakSet<object>(); // errors already written to the audit log

export const GAS_MARGIN_PCT = 15n;
const MAX_NETWORK_RETRIES = 3;
const AUDIT_LOG = join(AGENTS_DIR, "logs", "audit.jsonl");

export type TxRequest = {
  wallet: string; // name in agents/.env, e.g. AGENT_1
  action: string; // short verb for logs, e.g. "pay", "fund", "topup"
  to: Address;
  robot?: string; // robot id, if the tx is on behalf of a robot
  reason?: string; // why we're sending (shown in audit log / feed)
  value?: bigint;
  // either a contract call...
  abi?: Abi;
  functionName?: string;
  args?: readonly unknown[];
  // ...or raw data
  data?: Hex;
};

export type TxResult = {
  hash: Hash;
  link: string;
  nonce: number;
  gas: bigint;
  fee: bigint;
  receipt: TransactionReceipt;
};

/** A revert decoded into a readable custom error. Never retried. */
export class TxRevertedError extends Error {
  constructor(
    public readonly errorName: string,
    public readonly errorArgs: readonly unknown[],
    public readonly stage: "simulate" | "estimate" | "onchain",
    public readonly hash?: Hash,
  ) {
    super(`${errorName}${errorArgs.length ? `(${errorArgs.map(String).join(", ")})` : ""}`);
    this.name = "TxRevertedError";
  }
}

// ---------------- per-wallet queue + local nonce ----------------

const queues = new Map<string, Promise<unknown>>();
const nonces = new Map<string, number>();

function enqueue<T>(wallet: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(wallet) ?? Promise.resolve();
  const run = prev.then(job, job); // run after the previous send settles, success or failure
  queues.set(wallet, run.catch(() => undefined));
  return run;
}

async function nextNonce(wallet: string, address: Address, resync = false): Promise<number> {
  if (resync || !nonces.has(wallet)) {
    nonces.set(wallet, await publicClient.getTransactionCount({ address, blockTag: "pending" }));
  }
  return nonces.get(wallet)!;
}

// ---------------- error helpers ----------------

function revertData(err: unknown): Hex | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const found = err.walk((e) => typeof (e as { data?: unknown }).data === "string" && (e as { data: string }).data.startsWith("0x"));
  const data = (found as { data?: Hex } | null)?.data;
  return data && data.length >= 10 ? data : undefined;
}

/** Turns revert data into { name, args } using the given ABI (+ MonaidCore's), or a generic label. */
export function decodeRevert(err: unknown, abi?: Abi): { name: string; args: readonly unknown[] } | undefined {
  const data = revertData(err);
  if (!data) return undefined;
  for (const a of [abi, CORE_ABI].filter(Boolean) as Abi[]) {
    try {
      const d = decodeErrorResult({ abi: a, data });
      return { name: d.errorName, args: d.args ?? [] };
    } catch {
      /* try next */
    }
  }
  try {
    const d = decodeErrorResult({ data }); // Error(string) / Panic(uint256)
    return { name: d.errorName, args: d.args ?? [] };
  } catch {
    return { name: `UnknownError(${data.slice(0, 10)})`, args: [] };
  }
}

function isRevert(err: unknown): boolean {
  if (revertData(err)) return true;
  const msg = String((err as Error)?.message ?? err);
  return /execution reverted|revert/i.test(msg);
}

export function isNetworkError(err: unknown): boolean {
  if (err instanceof BaseError) {
    if (err.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError)) return true;
  }
  const msg = String((err as Error)?.message ?? err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|429|rate limit|Too Many Requests|503|502/i.test(msg);
}

const isNonceTooLow = (err: unknown) => /nonce too low|already known|known transaction/i.test(String((err as Error)?.message ?? err));

async function withNetworkRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= MAX_NETWORK_RETRIES || !isNetworkError(e)) throw e;
      const wait = 300 * 2 ** attempt;
      console.warn(`  ↻ network error during ${what}, retry ${attempt + 1}/${MAX_NETWORK_RETRIES} in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

// ---------------- audit log ----------------

const jsonSafe = (v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(jsonSafe) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonSafe(x)])) : v;

export function audit(entry: Record<string, unknown>) {
  mkdirSync(join(AGENTS_DIR, "logs"), { recursive: true });
  appendFileSync(AUDIT_LOG, JSON.stringify(jsonSafe({ time: new Date().toISOString(), ...entry })) + "\n");
}

// ---------------- sendTx ----------------

export function sendTx(req: TxRequest): Promise<TxResult> {
  return enqueue(req.wallet, () => sendNow(req));
}

async function sendNow(req: TxRequest): Promise<TxResult> {
  const client = walletClient(req.wallet);
  const from = client.account.address;
  const value = req.value ?? 0n;
  const data =
    req.data ?? (req.abi && req.functionName ? encodeFunctionData({ abi: req.abi, functionName: req.functionName, args: req.args ?? [] }) : undefined);
  const base = {
    robot: req.robot ?? null,
    wallet: req.wallet,
    from,
    action: req.action,
    to: req.to,
    args: req.args ?? [],
    value: formatEther(value),
    reason: req.reason ?? null,
  };

  const fail = (stage: TxRevertedError["stage"], err: unknown, hash?: Hash): never => {
    const d = decodeRevert(err, req.abi);
    if (d || isRevert(err)) {
      const e = new TxRevertedError(d?.name ?? "Reverted", d?.args ?? [], stage, hash);
      audit({ ...base, result: "reverted", stage, error: e.message, hash: hash ?? null, link: hash ? txLink(hash) : null });
      throw e;
    }
    audit({ ...base, result: "error", stage, error: String((err as Error)?.message ?? err).split("\n")[0], hash: hash ?? null });
    if (err && typeof err === "object") audited.add(err);
    throw err;
  };

  try {
    // 0. DEPLOYER hard floor, checked before anything else (re-checked with real gas after estimate)
    if (req.wallet === "DEPLOYER" && value > 0n) await assertDeployerCanSpend(value, 0n, `${req.action} (${formatEther(value)} MON)`);

    // 1. simulate
    try {
      await withNetworkRetry("simulate", () => publicClient.call({ account: from, to: req.to, data, value }));
    } catch (e) {
      if (isNetworkError(e)) throw e;
      fail("simulate", e);
    }

    // 2. estimate +15%
    let gas: bigint;
    try {
      const est = await withNetworkRetry("estimateGas", () => publicClient.estimateGas({ account: from, to: req.to, data, value }));
      gas = (est * (100n + GAS_MARGIN_PCT)) / 100n;
    } catch (e) {
      if (isNetworkError(e)) throw e;
      return fail("estimate", e);
    }

    // DEPLOYER hard floor on every value send
    if (req.wallet === "DEPLOYER" && value > 0n) await assertDeployerCanSpend(value, gas, `${req.action} (${formatEther(value)} MON)`);

    // 3. sign with our local nonce, 4. send (retry = resend the same raw tx), 5. wait
    const fees = await withNetworkRetry("fees", () => publicClient.estimateFeesPerGas());
    for (let nonceAttempt = 0; ; nonceAttempt++) {
      const nonce = await nextNonce(req.wallet, from, nonceAttempt > 0);
      const raw = await client.signTransaction({
        to: req.to,
        data,
        value,
        gas,
        nonce,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        chain: client.chain,
      });
      const hash = keccak256(raw);
      try {
        await withNetworkRetry("send", async () => {
          try {
            await publicClient.sendRawTransaction({ serializedTransaction: raw });
          } catch (e) {
            // A network retry of an already-accepted tx: same hash, fine.
            if (/already known|known transaction/i.test(String((e as Error)?.message))) return;
            throw e;
          }
        });
      } catch (e) {
        if (isNonceTooLow(e) && nonceAttempt < 2) continue; // someone else used the nonce: resync and re-sign
        throw e;
      }
      nonces.set(req.wallet, nonce + 1);

      const receipt = await withNetworkRetry("receipt", () => publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 }));
      const fee = gas * receipt.effectiveGasPrice;
      if (receipt.status !== "success") {
        // replay to recover the custom error name
        let decoded: unknown;
        try {
          await publicClient.call({ account: from, to: req.to, data, value, blockNumber: receipt.blockNumber });
        } catch (e) {
          decoded = e;
        }
        return fail("onchain", decoded ?? new Error("execution reverted"), hash);
      }
      audit({ ...base, result: "success", hash, link: txLink(hash), nonce, gas: gas.toString(), fee: formatEther(fee), block: receipt.blockNumber });
      return { hash, link: txLink(hash), nonce, gas, fee, receipt };
    }
  } catch (e) {
    if (e instanceof TxRevertedError) throw e;
    if (e instanceof FloorError) {
      audit({ ...base, result: "refused", stage: "floor", error: e.message.split("\n")[0] });
      throw e;
    }
    // network or other failure not yet logged
    if (!(e && typeof e === "object" && audited.has(e))) {
      audit({ ...base, result: "error", error: String((e as Error)?.message ?? e).split("\n")[0] });
    }
    throw e;
  }
}

/** One readable line for CLI output. */
export function describe(r: TxResult, label: string) {
  return `✔ ${label}\n    ${r.link}\n    nonce ${r.nonce}, gas limit ${r.gas}, fee ${formatEther(r.fee)} MON`;
}
