// Fee data cached in the background so a send doesn't wait on an extra RPC round-trip.
// Refreshed every tx.feeRefreshMs; a stale cache (> 3 intervals old, e.g. after RPC errors) is refetched inline.
import { publicClient, config } from "./chain.js";

export type Fees = { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint };

const REFRESH_MS: number =
  process.env.MONAID_TX_LEGACY === "1" ? 0 : ((config as { tx?: { feeRefreshMs?: number } }).tx?.feeRefreshMs ?? 0);

let cached: { fees: Fees; at: number } | undefined;
let inflight: Promise<Fees> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

async function fetchFees(): Promise<Fees> {
  inflight ??= publicClient
    .estimateFeesPerGas()
    .then((f) => {
      const fees = { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
      cached = { fees, at: Date.now() };
      return fees;
    })
    .finally(() => {
      inflight = undefined;
    });
  return inflight;
}

function startRefresher() {
  if (timer || REFRESH_MS <= 0) return;
  timer = setInterval(() => void fetchFees().catch(() => undefined), REFRESH_MS);
  timer.unref(); // never keeps a script alive
}

/** Cached fees if fresh, else fetch. With feeRefreshMs = 0 the cache is off (always fetch). */
export async function getFees(): Promise<Fees> {
  if (REFRESH_MS <= 0) return fetchFees();
  startRefresher();
  if (cached && Date.now() - cached.at < REFRESH_MS * 3) return cached.fees;
  return fetchFees();
}

/** Warm the cache at startup (agents service / scripts) so the first send doesn't pay for it. */
export function warmFees() {
  if (REFRESH_MS > 0) {
    startRefresher();
    void fetchFees().catch(() => undefined);
  }
}
