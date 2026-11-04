// DEPLOYER value sends (fund a robot, top up agents). Every one goes through assertDeployerCanSpend first.
// (P3 replaces sendSimple with the shared sendTx queue.)
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, type Address, type Hash } from "viem";
import { AGENTS_DIR, account } from "./env.js";
import { FLOORS, publicClient, txLink, walletClient } from "./chain.js";

export class FloorError extends Error {}

const mon = (wei: bigint) => `${Number(formatEther(wei)).toFixed(4)} MON`;

/**
 * Refuses unless DEPLOYER keeps >= the hard floor after `value` + worst-case gas (gas limit × max fee).
 * Message says how much it can still spend.
 */
export async function assertDeployerCanSpend(value: bigint, gasLimit: bigint, what: string) {
  const deployer = account("DEPLOYER").address;
  const [balance, fees] = await Promise.all([publicClient.getBalance({ address: deployer }), publicClient.estimateFeesPerGas()]);
  const gasCost = gasLimit * fees.maxFeePerGas;
  const after = balance - value - gasCost;
  if (after < FLOORS.deployer) {
    const spendable = balance - FLOORS.deployer - gasCost;
    throw new FloorError(
      `Refused: ${what} would leave DEPLOYER at ${mon(after)}, below the ${mon(FLOORS.deployer)} floor.\n` +
        `  DEPLOYER balance ${mon(balance)}, can still spend ${mon(spendable > 0n ? spendable : 0n)} (after gas).\n` +
        `  Add MON to DEPLOYER by hand: ${deployer}`,
    );
  }
  return { balance, gasCost, after };
}

/** Estimate +15% (Monad charges the gas limit), send, wait, print hash + link. */
export async function sendSimple(
  wallet: string,
  label: string,
  tx: { to: Address; value?: bigint; data?: `0x${string}` },
  prepared?: { gas: bigint },
): Promise<{ hash: Hash; fee: bigint }> {
  const client = walletClient(wallet);
  const gas = prepared?.gas ?? withMargin(await publicClient.estimateGas({ account: client.account, ...tx }));
  const hash = await client.sendTransaction({ ...tx, gas });
  const r = await publicClient.waitForTransactionReceipt({ hash });
  const fee = gas * r.effectiveGasPrice;
  if (r.status !== "success") throw new Error(`${label} reverted: ${txLink(hash)}`);
  console.log(`✔ ${label}\n    ${txLink(hash)}\n    fee ${formatEther(fee)} MON`);
  return { hash, fee };
}

export const withMargin = (est: bigint) => (est * 115n) / 100n;

// ---- daily top-up ledger (agents/logs/topups.jsonl) ----
const LEDGER = join(AGENTS_DIR, "logs", "topups.jsonl");
export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

export function toppedUpToday(): bigint {
  if (!existsSync(LEDGER)) return 0n;
  const today = utcDay();
  return readFileSync(LEDGER, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((e) => e.day === today)
    .reduce((s, e) => s + BigInt(e.amountWei), 0n);
}

export function recordTopup(e: { wallet: string; address: string; amountWei: bigint; hash: string }) {
  mkdirSync(join(AGENTS_DIR, "logs"), { recursive: true });
  appendFileSync(
    LEDGER,
    JSON.stringify({ ts: new Date().toISOString(), day: utcDay(), ...e, amountWei: e.amountWei.toString() }) + "\n",
  );
}

export { mon };
