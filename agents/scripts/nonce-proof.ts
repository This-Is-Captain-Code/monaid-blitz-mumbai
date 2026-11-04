// npm run proof:sendtx
// Proves the sendTx queue: fires 5 payments from ONE agent at the same time, and shows they land in nonce order
// with no nonce errors. Then shows a revert being caught in simulation and decoded (no gas spent).
import { formatEther, getAddress, keccak256, parseEther, slice, toHex } from "viem";
import { CORE_ABI, CORE_ADDRESS, publicClient, robotConfig } from "../src/chain.js";
import { TxRevertedError, sendTx } from "../src/tx.js";

const N = 5;
const AMOUNT = parseEther("0.001");
const robot = robotConfig(process.argv[2] ?? "1");
const TECH = getAddress(slice(keccak256(toHex("monaid-demo-technician")), 12));

console.log(`Firing ${N} pay() calls from ${robot.agent} at once (robot ${robot.id}, ${formatEther(AMOUNT)} MON each)…\n`);
const t0 = Date.now();
const results = await Promise.allSettled(
  Array.from({ length: N }, (_, i) =>
    sendTx({
      wallet: robot.agent,
      robot: robot.id,
      action: "pay",
      reason: `nonce proof #${i + 1}`,
      to: CORE_ADDRESS,
      abi: CORE_ABI,
      functionName: "pay",
      args: [robot.address, TECH, AMOUNT],
    }).then((r) => ({ i: i + 1, r })),
  ),
);
const ms = Date.now() - t0;

let fee = 0n;
const ok = results.flatMap((x) => (x.status === "fulfilled" ? [x.value] : []));
for (const x of results) {
  if (x.status === "rejected") console.log(`✖ ${String(x.reason?.message ?? x.reason)}`);
}
const rows = await Promise.all(
  ok.map(async ({ i, r }) => {
    fee += r.fee;
    return { call: i, nonce: r.nonce, block: Number(r.receipt.blockNumber), txIndex: r.receipt.transactionIndex, status: r.receipt.status, hash: r.hash };
  }),
);
console.table(rows);
for (const r of rows) console.log(`#${r.call}  https://testnet.monadscan.com/tx/${r.hash}`);

const nonces = rows.map((r) => r.nonce);
const consecutive = nonces.every((n, k) => k === 0 || n === nonces[k - 1] + 1);
const ordered = rows.every(
  (r, k) => k === 0 || r.block > rows[k - 1].block || (r.block === rows[k - 1].block && r.txIndex > rows[k - 1].txIndex),
);
console.log(
  `\n${ok.length}/${N} landed in ${ms} ms · nonces ${nonces.join(",")} · consecutive: ${consecutive} · chain order matches nonce order: ${ordered}`,
);
console.log(`Gas spent: ${formatEther(fee)} MON, paid out ${formatEther(AMOUNT * BigInt(ok.length))} MON from robot ${robot.id}'s balance`);

// Revert decoding: ask to pay far more than the robot holds. Caught at simulate, nothing sent.
try {
  await sendTx({
    wallet: robot.agent,
    robot: robot.id,
    action: "pay",
    reason: "decode check: overspend",
    to: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "pay",
    args: [robot.address, TECH, parseEther("1000")],
  });
  console.log("\n✖ expected a revert");
  process.exitCode = 1;
} catch (e) {
  if (!(e instanceof TxRevertedError)) throw e;
  console.log(`\nDecoded revert at ${e.stage}: ${e.message}  (not sent, 0 gas)`);
}
if (!(ok.length === N && consecutive && ordered)) process.exitCode = 1;
const bal = (await publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName: "balanceOf", args: [robot.address] })) as bigint;
console.log(`Robot ${robot.id} balance in MonaidCore now: ${formatEther(bal)} MON`);
