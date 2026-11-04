// npm run time:settle [-- <runs>] [--measure-gas]
// Full job cycles on MonaidCore v1 from AGENT_1 for robot 1: postJob → claim → settle, one at a time.
// Reports each step's sendTx total time (queue start → receipt), with the settle row as the headline.
//   MONAID_TX_LEGACY=1 npm run time:settle   → the old path (separate simulate, fresh fees, always estimate)
//   --measure-gas                            → also eth_estimateGas each step first, to size fixed gas limits
// Each run pays a tiny payout (1e12 wei) to a FRESH worker address (worst case gas: new account).
import { formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CORE_ABI, CORE_ADDRESS, publicClient, robotConfig } from "../src/chain.js";
import { account } from "../src/env.js";
import { warmFees } from "../src/fees.js";
import { TX_CFG, sendTx } from "../src/tx.js";

const runs = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 5);
const measureGas = process.argv.includes("--measure-gas");
const legacy = process.env.MONAID_TX_LEGACY === "1";
const robot = robotConfig("1");
const agent = account(robot.agent);
const PAYOUT = 1_000_000_000_000n; // 0.000001 MON
const WINDOW = 300n;

warmFees();
await new Promise((r) => setTimeout(r, 500)); // let the fee cache fill, as a running service would have
console.log(
  `${legacy ? "LEGACY" : "CURRENT"} path · separateSimulate=${TX_CFG.separateSimulate} · feeCache=${legacy ? "off" : "on"} · ` +
    `fixedGas=${JSON.stringify(TX_CFG.fixedGas)} · preflight=${TX_CFG.fixedGasPreflight} · ${runs} runs\n`,
);

const est = async (functionName: string, args: readonly unknown[]) =>
  publicClient.estimateGas({
    account: agent,
    to: CORE_ADDRESS,
    data: (await import("viem")).encodeFunctionData({ abi: CORE_ABI, functionName, args }),
  });

const rows: Record<string, number | string>[] = [];
const gasSeen: Record<string, bigint[]> = { postJob: [], claim: [], settle: [] };
let fee = 0n;

for (let i = 1; i <= runs; i++) {
  const worker = privateKeyToAccount(generatePrivateKey()).address;
  const call = (action: "postJob" | "claim" | "settle", args: readonly unknown[]) =>
    sendTx({ wallet: robot.agent, robot: robot.id, action, reason: `time:settle run ${i}`, to: CORE_ADDRESS, abi: CORE_ABI, functionName: action, args });

  if (measureGas) gasSeen.postJob.push(await est("postJob", [robot.address, PAYOUT, WINDOW]));
  const p = await call("postJob", [robot.address, PAYOUT, WINDOW]);
  const jobId = (await publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName: "jobCount" })) as bigint;

  if (measureGas) gasSeen.claim.push(await est("claim", [jobId, worker]));
  const c = await call("claim", [jobId, worker]);

  if (measureGas) gasSeen.settle.push(await est("settle", [jobId]));
  const s = await call("settle", [jobId]);

  fee += p.fee + c.fee + s.fee;
  rows.push({ run: i, job: Number(jobId), "postJob ms": p.totalMs, "claim ms": c.totalMs, "settle ms": s.totalMs, "settle gas limit": Number(s.gas), "settle tx": s.link });
}

console.table(rows.map(({ "settle tx": _, ...r }) => r));
for (const r of rows) console.log(`run ${r.run} settle: ${r["settle tx"]}`);
const st = rows.map((r) => r["settle ms"] as number);
console.log(
  `\nsettle  min ${Math.min(...st)} ms · avg ${Math.round(st.reduce((a, b) => a + b, 0) / st.length)} ms · max ${Math.max(...st)} ms` +
    `   ·   gas spent ${formatEther(fee)} MON`,
);
if (measureGas) {
  for (const [k, v] of Object.entries(gasSeen)) {
    const max = v.reduce((a, b) => (b > a ? b : a), 0n);
    console.log(`gas estimate ${k.padEnd(8)} ${v.join(", ")}  → max ${max}, +5% = ${(max * 105n + 99n) / 100n}`);
  }
}
