// npm run demo:pay [-- <robotId> <amountMON>]
// The P1 money-moves demo, now via sendTx: fund a robot (DEPLOYER), robot's agent pays a test address.
// Defaults: robot 1, fund 0.01 MON, pay 0.005 MON to the demo technician address.
import { formatEther, getAddress, keccak256, parseEther, slice, toHex } from "viem";
import { account } from "../src/env.js";
import { CORE_ABI, CORE_ADDRESS, publicClient, robotConfig } from "../src/chain.js";
import { FloorError } from "../src/funding.js";
import { TxRevertedError, describe, sendTx } from "../src/tx.js";

const [robotId = "1", payArg = "0.005"] = process.argv.slice(2);
const FUND = parseEther("0.01");
const PAY = parseEther(payArg);
// Throwaway technician (no key), same as the P1 demo.
const TECH = getAddress(slice(keccak256(toHex("monaid-demo-technician")), 12));

try {
  const robot = robotConfig(robotId);
  const agent = account(robot.agent).address;
  console.log(`MonaidCore ${CORE_ADDRESS}\nRobot ${robotId} ${robot.address} (agent ${robot.agent} ${agent})\nTechnician ${TECH} (demo)\n`);

  const balOf = async () =>
    (await publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName: "balanceOf", args: [robot.address] })) as bigint;

  const f = await sendTx({
    wallet: "DEPLOYER",
    robot: robotId,
    action: "fund",
    reason: "demo:pay top-up",
    to: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "fund",
    args: [robot.address],
    value: FUND,
  });
  console.log(describe(f, `fund robot ${robotId} with ${formatEther(FUND)} MON`));

  const p = await sendTx({
    wallet: robot.agent,
    robot: robotId,
    action: "pay",
    reason: "demo:pay technician",
    to: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "pay",
    args: [robot.address, TECH, PAY],
  });
  console.log(describe(p, `${robot.agent} pays ${formatEther(PAY)} MON -> technician`));

  console.log(`\nRobot ${robotId} balance in MonaidCore: ${formatEther(await balOf())} MON`);
  console.log(`Gas spent: ${formatEther(f.fee + p.fee)} MON`);
} catch (e) {
  if (e instanceof FloorError) console.error(e.message);
  else if (e instanceof TxRevertedError) console.error(`Reverted (${e.stage}): ${e.message}`);
  else console.error(`Error: ${(e as Error).message}`);
  process.exitCode = 1;
}
