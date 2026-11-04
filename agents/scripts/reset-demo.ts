// npm run reset:demo — back to a clean start for a rehearsal:
//   1. cancel open jobs, expire claimed ones (waits for the claim window if needed)
//   2. top up each robot's balance in MonaidCore to 0.5 MON (DEPLOYER, floor-checked)
//   3. top up agent gas wallets below their floor (to the target, daily cap applies)
//   4. reset device seqs + release the kill switch on the running API (if it's up)
//   5. print balances and explorer links
import { formatEther, parseEther } from "viem";
import { account } from "../src/env.js";
import { CORE_ABI, CORE_ADDRESS, FLOORS, addressLink, config, publicClient, robotConfig } from "../src/chain.js";
import { RobotAgent } from "../src/robot-agent.js";
import { listJobs } from "../src/ledger.js";
import { warmFees } from "../src/fees.js";
import { mon, recordTopup, toppedUpToday } from "../src/funding.js";
import { describe, sendTx } from "../src/tx.js";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_DIR, readEnv } from "../src/env.js";

const ROBOT_TARGET = parseEther("0.5");
warmFees();
const read = <T>(functionName: string, args: readonly unknown[]) =>
  publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName, args }) as Promise<T>;
const STATUS = ["None", "Open", "Claimed", "Settled", "Expired", "Cancelled"];
let gas = 0n;

console.log(`reset:demo · MonaidCore ${CORE_ADDRESS}\n`);

// 1. close jobs
console.log("1. open/claimed jobs");
for (const r of config.robots) {
  const agent = new RobotAgent(r.id);
  for (const j of listJobs(r.id)) {
    const onchain = await read<{ status: number; claimedAt: bigint; claimWindow: bigint }>("getJob", [BigInt(j.jobId)]);
    const status = STATUS[onchain.status];
    if (status === "Open") {
      const t = await agent.cancel(j.jobId, "reset:demo");
      gas += t.fee;
      console.log(`   ${r.id} job ${j.jobId}: cancelled ${t.link}`);
    } else if (status === "Claimed") {
      const deadline = Number(onchain.claimedAt + onchain.claimWindow);
      let chainNow = Number((await publicClient.getBlock()).timestamp);
      if (chainNow <= deadline) console.log(`   ${r.id} job ${j.jobId}: claimed, waiting ${deadline - chainNow + 1}s for the window…`);
      while (chainNow <= deadline) {
        await new Promise((res) => setTimeout(res, 1000));
        chainNow = Number((await publicClient.getBlock()).timestamp);
      }
      const t = await agent.expire(j.jobId, "reset:demo");
      gas += t.fee;
      console.log(`   ${r.id} job ${j.jobId}: expired ${t.link}`);
    } else if (status !== j.status) {
      await agent.refreshJob(j.jobId);
    }
  }
}

// 2. robots to 0.5 MON
console.log("2. robot balances in MonaidCore → 0.5 MON");
for (const r of config.robots) {
  const rc = robotConfig(r.id);
  const bal = await read<bigint>("balanceOf", [rc.address]);
  if (bal >= ROBOT_TARGET) {
    console.log(`   ${r.id}: ${formatEther(bal)} MON — ok`);
    continue;
  }
  const t = await sendTx({ wallet: "DEPLOYER", robot: r.id, action: "fund", reason: "reset:demo", to: CORE_ADDRESS, abi: CORE_ABI, functionName: "fund", args: [rc.address], value: ROBOT_TARGET - bal });
  gas += t.fee;
  console.log(describe(t, `   ${r.id}: +${formatEther(ROBOT_TARGET - bal)} MON`));
}

// 3. agent gas
console.log("3. agent gas wallets (floor 1 MON → refill to 3 MON)");
let capLeft = FLOORS.agentDailyCap - toppedUpToday();
for (const r of config.robots) {
  const to = account(r.agent).address;
  const bal = await publicClient.getBalance({ address: to });
  if (bal >= FLOORS.agentGas) {
    console.log(`   ${r.agent}: ${mon(bal)} — ok`);
    continue;
  }
  const amount = FLOORS.agentTarget - bal > capLeft ? capLeft : FLOORS.agentTarget - bal;
  if (amount <= 0n) {
    console.log(`   ${r.agent}: ${mon(bal)} below floor but the daily top-up cap is used up`);
    continue;
  }
  const t = await sendTx({ wallet: "DEPLOYER", robot: r.id, action: "topup", reason: "reset:demo", to, value: amount });
  recordTopup({ wallet: r.agent, address: to, amountWei: amount, hash: t.hash });
  capLeft -= amount;
  gas += t.fee;
  console.log(describe(t, `   ${r.agent}: +${mon(amount)}`));
}

// 4. API state
console.log("4. API state");
const apiCfg = (config as unknown as { api: { host: string; port: number } }).api;
const BASE = `http://${apiCfg.host === "0.0.0.0" ? "127.0.0.1" : apiCfg.host}:${apiCfg.port}`;
const H = { "content-type": "application/json", "x-monaid-token": readEnv().MONAID_API_TOKEN ?? "" };
const up = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
if (up) {
  await fetch(`${BASE}/admin/reset-seq`, { method: "POST", headers: H, body: "{}" });
  const k = await fetch(`${BASE}/admin/kill`, { method: "POST", headers: H, body: JSON.stringify({ engaged: false }) }).then((r) => r.json());
  console.log(`   API up at ${BASE}: duplicate cache cleared, kill switch ${k.engaged ? "ENGAGED" : "off"} (restart the API to clear pending approvals)`);
} else {
  const f = join(AGENTS_DIR, "logs", "seq.json");
  if (existsSync(f)) rmSync(f);
  console.log(`   API not running: cleared logs/seq.json (start it with npm run api)`);
}

// 5. balances
console.log("\n5. ready:");
for (const name of ["DEPLOYER", ...config.robots.map((r) => r.agent)]) {
  const a = account(name).address;
  console.log(`   ${name.padEnd(9)} ${mon(await publicClient.getBalance({ address: a })).padStart(14)}  ${addressLink(a)}`);
}
for (const r of config.robots) {
  const rc = robotConfig(r.id);
  const [bal, esc] = await Promise.all([read<bigint>("balanceOf", [rc.address]), read<bigint>("escrowOf", [rc.address])]);
  console.log(`   robot ${r.id.padEnd(10)} balance ${formatEther(bal)} MON, escrow ${formatEther(esc)} MON  ${addressLink(rc.address)}`);
}
console.log(`   MonaidCore ${addressLink(CORE_ADDRESS)}\n   gas spent by reset: ${formatEther(gas)} MON`);
