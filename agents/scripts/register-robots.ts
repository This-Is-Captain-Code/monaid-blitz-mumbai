// npm run register:robots — DEPLOYER registers every robot in config.json with its agent wallet.
// Gas only (no value), idempotent: skips robots already registered to the right agent. Sends via sendTx.
import { formatEther, zeroAddress, type Address } from "viem";
import { account } from "../src/env.js";
import { CORE_ABI, CORE_ADDRESS, config, publicClient, robotAddress } from "../src/chain.js";
import { describe, sendTx } from "../src/tx.js";

let spent = 0n;
for (const r of config.robots) {
  const robot = robotAddress(r.id);
  const agent = account(r.agent).address;
  const current = (await publicClient.readContract({
    address: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "agentOf",
    args: [robot],
  })) as Address;

  if (current !== zeroAddress) {
    if (current.toLowerCase() !== agent.toLowerCase()) throw new Error(`Robot ${r.id} is registered to ${current}, not ${r.agent}`);
    console.log(`• robot ${r.id} (${robot}) already registered to ${r.agent} — skipped`);
    continue;
  }
  const res = await sendTx({
    wallet: "DEPLOYER",
    robot: r.id,
    action: "registerRobot",
    reason: `register robot ${r.id} with ${r.agent}`,
    to: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "registerRobot",
    args: [robot, agent],
  });
  console.log(describe(res, `registerRobot robot ${r.id} (${robot}) -> ${r.agent} ${agent}`));
  spent += res.fee;
}
console.log(`\nGas spent: ${formatEther(spent)} MON`);
