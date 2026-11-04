// npm run register:robots — DEPLOYER registers every robot in config.json with its agent wallet.
// Gas only (no value), idempotent: skips robots already registered to the right agent.
import { encodeFunctionData, formatEther, zeroAddress, type Address } from "viem";
import { account } from "../src/env.js";
import { CORE_ABI, CORE_ADDRESS, config, publicClient, robotAddress } from "../src/chain.js";
import { sendSimple, withMargin } from "../src/funding.js";

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
  const data = encodeFunctionData({ abi: CORE_ABI, functionName: "registerRobot", args: [robot, agent] });
  const gas = withMargin(await publicClient.estimateGas({ account: account("DEPLOYER"), to: CORE_ADDRESS, data }));
  const { fee } = await sendSimple("DEPLOYER", `registerRobot robot ${r.id} (${robot}) -> ${r.agent} ${agent}`, { to: CORE_ADDRESS, data }, { gas });
  spent += fee;
}
console.log(`\nGas spent: ${formatEther(spent)} MON`);
