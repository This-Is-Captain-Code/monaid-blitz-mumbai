// npm run demo:guardrails — each guardrail blocking something, one clean line per case (demo beats).
// Robot 1 / AGENT_1 on MonaidCore. Uses a tighter demo policy so every cap is reachable with tiny amounts.
// Gas: one real postJob + its cleanup cancel, and one deliberate on-chain revert (~0.045 MON total).
import { parseEther } from "viem";
import { CORE_ABI, CORE_ADDRESS, robotConfig } from "../src/chain.js";
import { parsePolicy } from "../src/policy.js";
import { RobotAgent, PolicyBlockedError } from "../src/robot-agent.js";
import { reject } from "../src/approvals.js";
import { engageKillSwitch, releaseKillSwitch, KillSwitchError } from "../src/killswitch.js";
import { TxRevertedError, sendTx } from "../src/tx.js";
import { warmFees } from "../src/fees.js";

warmFees();
const demoPolicy = parsePolicy({
  maxPayoutPerJob: "0.05",
  maxSpendPerDay: "0.03",
  maxOpenJobs: 1,
  ownerApprovalAbove: "0.02",
  allowedActions: ["postJob", "claim", "settle", "expire", "cancel"],
});
const agent = new RobotAgent("1", demoPolicy);
const noSettle = new RobotAgent("1", { ...demoPolicy, allowedActions: ["postJob", "claim", "expire", "cancel"] });
const WINDOW = 120;

const lines: string[] = [];
const line = (ok: boolean, label: string, detail: string) => {
  const l = `${ok ? "✔" : "✖"} ${label.padEnd(22)} ${detail}`;
  lines.push(l);
  console.log(l);
};
const expectBlock = async (label: string, fn: () => Promise<unknown>, want: string) => {
  try {
    await fn();
    line(false, label, `expected ${want}, but it went through`);
  } catch (e) {
    const ok = e instanceof PolicyBlockedError ? e.code === want : e instanceof KillSwitchError && want === "KILL_SWITCH";
    line(ok, label, `${(e as Error).message}  — off-chain, nothing sent`);
  }
};

console.log(
  `Guardrails demo · robot 1 · demo policy: maxPayoutPerJob 0.05, maxSpendPerDay 0.03, maxOpenJobs 1, ownerApprovalAbove 0.02 MON\n` +
    `On-chain cap (MonaidCore.maxPayout): 0.1 MON\n`,
);

// 1. policy cap
await expectBlock("policy cap", () => agent.postJob({ payout: "0.08", claimWindow: WINDOW, reason: "demo: policy cap" }), "PAYOUT_ABOVE_POLICY");

// 2. owner approval
const p = await agent.postJob({ payout: "0.03", claimWindow: WINDOW, reason: "demo: approval" });
if (p.status === "pending_approval") {
  reject(p.approval.id);
  line(true, "owner approval", `postJob 0.03 MON > 0.02 threshold → queued as approval ${p.approval.id}, owner rejected — nothing sent`);
} else line(false, "owner approval", "expected the job to wait for approval");

// 3. a real job inside every limit (needed for the next two)
const ok = await agent.postJob({ payout: "0.02", claimWindow: WINDOW, reason: "demo: allowed job" });
const jobId = ok.status === "posted" ? ok.jobId : "";
line(ok.status === "posted", "allowed job", ok.status === "posted" ? `postJob 0.02 MON → job ${jobId} posted ${ok.tx.link}` : "not posted");

// 4. daily cap
await expectBlock("daily cap", () => agent.postJob({ payout: "0.02", claimWindow: WINDOW, reason: "demo: daily cap" }), "DAILY_CAP");

// 5. max open jobs
await expectBlock("max open jobs", () => agent.postJob({ payout: "0.005", claimWindow: WINDOW, reason: "demo: open jobs" }), "TOO_MANY_OPEN_JOBS");

// 6. action not allowed
await expectBlock("action not allowed", () => noSettle.settleOnProof(jobId, { kind: "power_on" }, "demo: not allowed"), "ACTION_NOT_ALLOWED");

// 7. kill switch — stops every send, robot agents and DEPLOYER alike
engageKillSwitch("guardrails demo");
await expectBlock("kill switch (agent)", () => agent.cancel(jobId, "demo: kill switch"), "KILL_SWITCH");
await expectBlock("kill switch (deployer)", () =>
  sendTx({ wallet: "DEPLOYER", action: "fund", to: CORE_ADDRESS, abi: CORE_ABI, functionName: "fund", args: [robotConfig("1").address], value: 1n }),
"KILL_SWITCH");
releaseKillSwitch();

// 8. skip the off-chain check on purpose: the contract still says no — on-chain, readable on the explorer
try {
  await sendTx({
    wallet: agent.wallet,
    robot: "1",
    action: "postJob",
    reason: "demo: bypass off-chain policy",
    to: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "postJob",
    args: [robotConfig("1").address, parseEther("0.2"), BigInt(WINDOW)],
    skipPreflight: true,
  });
  line(false, "on-chain cap", "expected a revert");
} catch (e) {
  if (!(e instanceof TxRevertedError)) throw e;
  line(e.stage === "onchain", "on-chain cap", `policy skipped, postJob 0.2 MON → MonaidCore reverted ${e.message} https://testnet.monadscan.com/tx/${e.hash}`);
}

// cleanup: cancel the demo job (escrow back to robot 1, daily spend credited back)
if (jobId) {
  const c = await agent.cancel(jobId, "demo cleanup");
  console.log(`\n(cleanup) cancelled job ${jobId}, escrow back to robot 1: ${c.link}`);
}
const failed = lines.filter((l) => l.startsWith("✖")).length;
console.log(`\n${lines.length - failed}/${lines.length} guardrail beats as expected.`);
if (failed) process.exitCode = 1;
