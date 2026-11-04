// npm run check:agent — live check of RobotAgent on robot 2 (AGENT_2), with the real policy.json:
//   A) owner approval: postJob 0.03 (> 0.02 threshold) waits → owner approves → posted → cancel (escrow back)
//   B) happy path: postJob → acceptClaim(fresh worker) → settleOnProof
//   C) fail path:  postJob (2 s window) → acceptClaim → window passes → expire (escrow back)
import { formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CORE_ABI, CORE_ADDRESS, publicClient } from "../src/chain.js";
import { RobotAgent } from "../src/robot-agent.js";
import { approve, listApprovals } from "../src/approvals.js";
import { warmFees } from "../src/fees.js";

warmFees();
const agent = new RobotAgent("2");
const bal = async () =>
  formatEther((await publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName: "balanceOf", args: [agent.robotAddress] })) as bigint);
const worker = () => privateKeyToAccount(generatePrivateKey()).address;
console.log(`robot 2 balance in MonaidCore: ${await bal()} MON\n`);

// A
const a = await agent.postJob({ payout: "0.03", claimWindow: 300, reason: "check: approval" });
if (a.status !== "pending_approval") throw new Error("expected pending approval");
console.log(`A ⏸ ${a.approval.summary} → pending approval ${a.approval.id} (pending: ${listApprovals("pending").length})`);
const r = (await approve(a.approval.id)) as Awaited<ReturnType<RobotAgent["postJob"]>>;
if (r.status !== "posted") throw new Error("expected posted after approval");
console.log(`A ✔ owner approved → job ${r.jobId} posted ${r.tx.link}`);
const ca = await agent.cancel(r.jobId, "check: approval cleanup");
console.log(`A ✔ cancelled job ${r.jobId} (escrow back) ${ca.link}`);

// B
const b = await agent.postJob({ payout: "0.001", claimWindow: 300, reason: "check: happy path" });
if (b.status !== "posted") throw new Error("expected posted");
const w = worker();
const cl = await agent.acceptClaim(b.jobId, w, "check: claim");
const st = await agent.settleOnProof(b.jobId, { kind: "power_on", seq: 1 }, "check: proof");
console.log(`B ✔ job ${b.jobId}: posted ${b.tx.link}\n      claimed by ${w} ${cl.link}\n      settled (0.001 MON paid) ${st.link}`);

// C
const c = await agent.postJob({ payout: "0.001", claimWindow: 2, reason: "check: fail path" });
if (c.status !== "posted") throw new Error("expected posted");
await agent.acceptClaim(c.jobId, worker(), "check: claim, no fix");
const deadline = Number(await publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName: "claimDeadline", args: [BigInt(c.jobId)] }));
while (Number((await publicClient.getBlock()).timestamp) <= deadline) await new Promise((res) => setTimeout(res, 500));
const ex = await agent.expire(c.jobId, "check: window passed");
console.log(`C ✔ job ${c.jobId}: claimed, no proof, window passed → expired, escrow back ${ex.link}`);

console.log(`\nrobot 2 balance in MonaidCore: ${await bal()} MON (0.001 paid to the B worker)`);
console.log("local job records:", agent.jobs().map((j) => `${j.jobId}:${j.status}`).join(", "), "· status:", JSON.stringify(agent.status()));
