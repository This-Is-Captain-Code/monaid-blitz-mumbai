// npm run fund:robot -- <robotId> <amountMON>
// DEPLOYER funds a robot's balance inside MonaidCore via sendTx (which enforces the DEPLOYER floor).
import { formatEther, parseEther, zeroAddress, type Address } from "viem";
import { CORE_ABI, CORE_ADDRESS, publicClient, robotConfig } from "../src/chain.js";
import { FloorError } from "../src/funding.js";
import { TxRevertedError, describe, sendTx } from "../src/tx.js";

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

  const res = await sendTx({
    wallet: "DEPLOYER",
    robot: robotId,
    action: "fund",
    reason: `fund robot ${robotId} with ${amountArg} MON`,
    to: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "fund",
    args: [robot.address],
    value,
  });
  console.log(describe(res, `fund robot ${robotId} with ${amountArg} MON`));
  const bal = (await publicClient.readContract({
    address: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "balanceOf",
    args: [robot.address],
  })) as bigint;
  console.log(`Robot ${robotId} balance in MonaidCore: ${formatEther(bal)} MON`);
} catch (e) {
  if (e instanceof FloorError) console.error(e.message);
  else if (e instanceof TxRevertedError) console.error(`Reverted (${e.stage}): ${e.message}`);
  else console.error(`Error: ${(e as Error).message}`);
  process.exitCode = 1;
}
