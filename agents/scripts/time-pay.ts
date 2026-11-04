// npm run time:pay [-- <runs>]
// Measures single pay() calls one at a time: time from send accepted → receipt seen (sendTx confirmMs).
import { formatEther, getAddress, keccak256, parseEther, slice, toHex } from "viem";
import { CORE_ABI, CORE_ADDRESS, publicClient, robotConfig } from "../src/chain.js";
import { sendTx } from "../src/tx.js";

const runs = Number(process.argv[2] ?? 5);
const robot = robotConfig("1");
const TECH = getAddress(slice(keccak256(toHex("monaid-demo-technician")), 12));

console.log(`Receipt polling interval: ${publicClient.pollingInterval} ms. ${runs} sequential pay() calls from ${robot.agent}…`);
const times: number[] = [];
let fee = 0n;
for (let i = 1; i <= runs; i++) {
  const r = await sendTx({
    wallet: robot.agent,
    robot: robot.id,
    action: "pay",
    reason: `timing run ${i}`,
    to: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "pay",
    args: [robot.address, TECH, parseEther("0.001")],
  });
  times.push(r.confirmMs);
  fee += r.fee;
  console.log(`  #${i}  send→receipt ${String(r.confirmMs).padStart(5)} ms   ${r.link}`);
}
const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
console.log(`min ${Math.min(...times)} ms · avg ${avg} ms · max ${Math.max(...times)} ms · gas ${formatEther(fee)} MON`);
