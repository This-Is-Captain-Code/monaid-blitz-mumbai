// Funding rules: DEPLOYER hard floor and the daily agent top-up ledger.
// Sending itself goes through sendTx (src/tx.ts), which calls assertDeployerCanSpend on every DEPLOYER value send.
import { appendFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther } from "viem";
import { AGENTS_DIR, account } from "./env.js";
import { FLOORS, publicClient } from "./chain.js";
import { getFees } from "./fees.js";

export class FloorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FloorError";
  }
}

export const mon = (wei: bigint) => `${Number(formatEther(wei)).toFixed(4)} MON`;

/**
 * Refuses unless DEPLOYER keeps >= the hard floor after `value` + worst-case gas (gas limit × max fee).
 * The message says how much it can still spend and where to send MON by hand.
 */
export async function assertDeployerCanSpend(value: bigint, gasLimit: bigint, what: string) {
  const deployer = account("DEPLOYER").address;
  const [balance, fees] = await Promise.all([publicClient.getBalance({ address: deployer }), getFees()]);
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
