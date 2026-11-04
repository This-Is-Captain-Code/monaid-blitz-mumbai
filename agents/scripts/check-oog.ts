// npm run check:oog — proves the out-of-gas fallback for fixed-gas actions on testnet.
//  A) preflight on: a too-small fixed limit is caught by the simulation (nothing sent), then estimation sends it.
//  B) preflight off: the too-small limit goes on-chain, fails out-of-gas (gas spent), then ONE retry with estimation.
// Uses a cheap postJob + cancel on robot 1 (escrow returns). AGENT_1 pays gas.
import { formatEther } from "viem";
import { CORE_ABI, CORE_ADDRESS, publicClient, robotConfig } from "../src/chain.js";
import { TX_CFG, sendTx } from "../src/tx.js";

const robot = robotConfig("1");
const PAYOUT = 1_000_000_000_000n;
const call = (action: string, functionName: string, args: readonly unknown[], reason: string) =>
  sendTx({ wallet: robot.agent, robot: robot.id, action, reason, to: CORE_ADDRESS, abi: CORE_ABI, functionName, args });

const real = { ...TX_CFG.fixedGas };
let fee = 0n;
for (const [label, preflight] of [["A preflight ON ", true], ["B preflight OFF", false]] as const) {
  TX_CFG.fixedGas = { ...real, postJob: 60_000 }; // far below the ~148k postJob needs
  TX_CFG.fixedGasPreflight = preflight;
  console.log(`\n== ${label}: fixed postJob limit 60000 ==`);
  const r = await call("postJob", "postJob", [robot.address, PAYOUT, 300n], `check:oog ${label.trim()}`);
  fee += r.fee;
  console.log(`✔ posted after fallback: gas limit ${r.gas} (estimated), ${r.link}`);
  TX_CFG.fixedGas = real;
  TX_CFG.fixedGasPreflight = true;
  const id = (await publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName: "jobCount" })) as bigint;
  const c = await call("cancel", "cancel", [id], "check:oog cleanup");
  fee += c.fee;
  console.log(`  cancelled job ${id} (escrow back): ${c.link}`);
}
console.log(`\nGas for the successful sends: ${formatEther(fee)} MON (+ the failed on-chain attempt in B, see audit log).`);
