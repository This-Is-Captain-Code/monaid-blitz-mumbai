// npm run fund:robot -- <robotId> <amountMON>
// DEPLOYER funds a robot's balance inside MonaidCore. Refuses if DEPLOYER would drop below its floor.
import { encodeFunctionData, formatEther, parseEther, zeroAddress, type Address } from "viem";
import { account } from "../src/env.js";
import { CORE_ABI, CORE_ADDRESS, publicClient, robotConfig } from "../src/chain.js";
import { FloorError, assertDeployerCanSpend, sendSimple, withMargin } from "../src/funding.js";

const [robotId, amountArg] = process.argv.slice(2);
if (!robotId || !amountArg) {
  console.error("Usage: npm run fund:robot -- <robotId> <amountMON>   e.g. 1 0.5");
  process.exit(1);
}

try {
  const robot = robotConfig(robotId);
  const value = parseEther(amountArg);
  if (value <= 0n) throw new Error("Amount must be > 0");

  const agentOf = (await publicClient.readContract({
    address: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "agentOf",
    args: [robot.address],
  })) as Address;
  if (agentOf === zeroAddress) throw new Error(`Robot ${robotId} is not registered — run npm run register:robots`);

  const data = encodeFunctionData({ abi: CORE_ABI, functionName: "fund", args: [robot.address] });
  const gas = withMargin(await publicClient.estimateGas({ account: account("DEPLOYER"), to: CORE_ADDRESS, data, value }));
  await assertDeployerCanSpend(value, gas, `funding robot ${robotId} with ${amountArg} MON`);

  await sendSimple("DEPLOYER", `fund robot ${robotId} with ${amountArg} MON`, { to: CORE_ADDRESS, data, value }, { gas });
  const bal = (await publicClient.readContract({
    address: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "balanceOf",
    args: [robot.address],
  })) as bigint;
  console.log(`Robot ${robotId} balance in MonaidCore: ${formatEther(bal)} MON`);
} catch (e) {
  console.error(e instanceof FloorError ? e.message : `Error: ${(e as Error).message}`);
  process.exitCode = 1;
}
