// npm run check:refusals — no gas: a revert caught at estimate, and a DEPLOYER floor refusal. Both must be clean.
import { parseEther } from "viem";
import { CORE_ABI, CORE_ADDRESS, robotConfig } from "../src/chain.js";
import { FloorError } from "../src/funding.js";
import { TxRevertedError, sendTx } from "../src/tx.js";

const r1 = robotConfig("1");
let ok = true;
try {
  await sendTx({
    wallet: r1.agent,
    robot: "1",
    action: "pay",
    reason: "check: overspend",
    to: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "pay",
    args: [r1.address, r1.address, parseEther("1000")],
  });
  ok = false;
  console.log("✖ overspend was sent");
} catch (e) {
  if (!(e instanceof TxRevertedError)) throw e;
  console.log(`✔ revert caught before sending (${e.stage}): ${e.message}`);
}
try {
  await sendTx({
    wallet: "DEPLOYER",
    robot: "2",
    action: "fund",
    reason: "check: floor",
    to: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "fund",
    args: [robotConfig("2").address],
    value: parseEther("50"),
  });
  ok = false;
  console.log("✖ floor not enforced");
} catch (e) {
  if (!(e instanceof FloorError)) throw e;
  console.log(`✔ floor refusal:\n${e.message}`);
}
if (!ok) process.exitCode = 1;
