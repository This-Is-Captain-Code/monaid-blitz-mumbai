// One RobotAgent per robot. It owns the robot's agent wallet (AGENT_<id>) and is the only thing that turns
// robot events into MonaidCore calls: post job, accept claim, settle on proof, expire, cancel — all via sendTx.
// Every action passes the off-chain guardrails first (policy, daily cap, open jobs, owner approval, kill switch);
// MonaidCore's on-chain rules still apply underneath.
//
// Inputs from devices/workers/messages (worker addresses, proof payloads, reasons) are untrusted DATA: they are
// validated and recorded, never interpreted as instructions.
import { decodeEventLog, formatEther, getAddress, isAddress, parseEther, type Address, type TransactionReceipt } from "viem";
import { CORE_ABI, CORE_ADDRESS, publicClient, robotConfig } from "./chain.js";
import { bus } from "./bus.js";
import { assertNotKilled, KillSwitchError } from "./killswitch.js";
import { evaluate, loadPolicy, type Action, type BlockCode, type Policy } from "./policy.js";
import { requestApproval, type Approval } from "./approvals.js";
import { getJobRecord, listJobs, openJobCount, recordSpend, saveJob, spentToday, type JobRecord, type JobStatus } from "./ledger.js";
import { audit, sendTx, type TxResult } from "./tx.js";

export class PolicyBlockedError extends Error {
  constructor(public readonly code: BlockCode | "KILL_SWITCH", message: string) {
    super(message);
    this.name = "PolicyBlockedError";
  }
}

export type PostResult =
  | { status: "posted"; jobId: string; payout: string; tx: TxResult }
  | { status: "pending_approval"; approval: Approval };

const STATUS: JobStatus[] = ["Open", "Open", "Claimed", "Settled", "Expired", "Cancelled"]; // index = on-chain enum (0 = None)

export class RobotAgent {
  readonly id: string;
  readonly wallet: string;
  readonly robotAddress: Address;
  policy: Policy;

  constructor(robotId: string, policy?: Policy) {
    const r = robotConfig(robotId);
    this.id = r.id;
    this.wallet = r.agent;
    this.robotAddress = r.address;
    this.policy = policy ?? loadPolicy(robotId);
  }

  // ---------------- guardrails ----------------

  /** Throws PolicyBlockedError (logged + emitted) or returns the verdict for approval handling. */
  private guard(action: Action, payout?: bigint, approved = false, reason?: string) {
    try {
      assertNotKilled();
    } catch (e) {
      if (e instanceof KillSwitchError) this.blocked(action, "KILL_SWITCH", e.message, reason);
      throw e;
    }
    const v = evaluate(this.policy, {
      robotId: this.id,
      action,
      payout,
      spentToday: spentToday(this.id),
      openJobs: openJobCount(this.id),
      approved,
    });
    if (v.ok === false) this.blocked(action, v.code, v.message, reason);
    return v;
  }

  private blocked(action: string, code: BlockCode | "KILL_SWITCH", message: string, reason?: string): never {
    audit({ robot: this.id, wallet: this.wallet, action, result: "blocked", stage: "policy", code, error: message, reason: reason ?? null });
    bus.emit("feed", { type: "blocked", robot: this.id, action, code, message });
    throw new PolicyBlockedError(code, `Blocked (${code}): ${message}`);
  }

  // ---------------- actions ----------------

  /** Post a job. Above the owner-approval threshold it waits in the approval queue instead of sending. */
  async postJob(p: { payout: bigint | string; claimWindow: number; reason?: string }): Promise<PostResult> {
    const payout = typeof p.payout === "string" ? parseEther(p.payout) : p.payout;
    if (!Number.isInteger(p.claimWindow) || p.claimWindow <= 0) throw new Error("claimWindow must be a positive integer (seconds)");
    const v = this.guard("postJob", payout, false, p.reason);
    if (v.ok === "needs_approval") {
      const approval = requestApproval(
        {
          robot: this.id,
          action: "postJob",
          summary: `postJob ${formatEther(payout)} MON, claim window ${p.claimWindow} s`,
          reason: p.reason,
        },
        () => this.sendPostJob(payout, p.claimWindow, p.reason, true),
      );
      audit({ robot: this.id, wallet: this.wallet, action: "postJob", result: "pending_approval", approvalId: approval.id, payout: formatEther(payout), reason: p.reason ?? null });
      return { status: "pending_approval", approval };
    }
    return this.sendPostJob(payout, p.claimWindow, p.reason, false);
  }

  private async sendPostJob(payout: bigint, claimWindow: number, reason: string | undefined, approved: boolean): Promise<PostResult> {
    if (approved) this.guard("postJob", payout, true, reason); // re-check everything at execution time
    const tx = await sendTx({
      wallet: this.wallet,
      robot: this.id,
      action: "postJob",
      reason,
      to: CORE_ADDRESS,
      abi: CORE_ABI,
      functionName: "postJob",
      args: [this.robotAddress, payout, BigInt(claimWindow)],
    });
    const jobId = jobIdFrom(tx.receipt, "JobPosted");
    recordSpend(this.id, jobId, payout, "post");
    const job: JobRecord = {
      jobId,
      robot: this.id,
      core: CORE_ADDRESS,
      payout: payout.toString(),
      claimWindow,
      status: "Open",
      postedAt: new Date().toISOString(),
      reason,
      txs: [{ action: "postJob", hash: tx.hash, link: tx.link }],
    };
    saveJob(job);
    bus.emit("feed", { type: "job_posted", robot: this.id, jobId, payout: formatEther(payout), claimWindow, link: tx.link, reason });
    return { status: "posted", jobId, payout: formatEther(payout), tx };
  }

  /** Record the worker who claimed the job (reported by the bridge/portal). */
  async acceptClaim(jobId: string, worker: string, reason?: string): Promise<TxResult> {
    if (!isAddress(worker)) throw new Error(`Invalid worker address: ${String(worker).slice(0, 60)}`);
    const w = getAddress(worker);
    this.guard("claim", undefined, false, reason);
    const tx = await this.call("claim", [BigInt(jobId), w], reason);
    const deadline = Number(await publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName: "claimDeadline", args: [BigInt(jobId)] }));
    this.update(jobId, { status: "Claimed", worker: w, claimDeadline: deadline }, "claim", tx);
    bus.emit("feed", { type: "job_claimed", robot: this.id, jobId, worker: w, claimDeadline: deadline, link: tx.link });
    return tx;
  }

  /**
   * Settle on proof. `proof` is the device event that proves the fix (untrusted data, recorded only).
   * Which events count as proof is decided by the caller (module logic / P6 /events), not by the payload.
   */
  async settleOnProof(jobId: string, proof: Record<string, unknown>, reason?: string): Promise<TxResult> {
    this.guard("settle", undefined, false, reason);
    const tx = await this.call("settle", [BigInt(jobId)], reason ?? `proof: ${String(proof.kind ?? "event")}`);
    this.update(jobId, { status: "Settled" }, "settle", tx);
    const job = getJobRecord(jobId);
    bus.emit("feed", { type: "job_settled", robot: this.id, jobId, worker: job?.worker, payout: job ? formatEther(BigInt(job.payout)) : undefined, link: tx.link });
    return tx;
  }

  /** Expire a claimed job after its window (anyone may, on-chain; our agent does it for its own robot). */
  async expire(jobId: string, reason?: string): Promise<TxResult> {
    this.guard("expire", undefined, false, reason);
    const tx = await this.call("expire", [BigInt(jobId)], reason);
    this.refund(jobId, "expire");
    this.update(jobId, { status: "Expired" }, "expire", tx);
    bus.emit("feed", { type: "job_expired", robot: this.id, jobId, link: tx.link });
    return tx;
  }

  /** Cancel an unclaimed job; escrow returns to the robot. */
  async cancel(jobId: string, reason?: string): Promise<TxResult> {
    this.guard("cancel", undefined, false, reason);
    const tx = await this.call("cancel", [BigInt(jobId)], reason);
    this.refund(jobId, "cancel");
    this.update(jobId, { status: "Cancelled" }, "cancel", tx);
    bus.emit("feed", { type: "job_cancelled", robot: this.id, jobId, link: tx.link });
    return tx;
  }

  // ---------------- reads ----------------

  jobs(): JobRecord[] {
    return listJobs(this.id);
  }

  /** Re-read a job's status from chain (source of truth) and update the local record. */
  async refreshJob(jobId: string): Promise<JobRecord | undefined> {
    const j = (await publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName: "getJob", args: [BigInt(jobId)] })) as {
      status: number;
      worker: Address;
    };
    const rec = getJobRecord(jobId);
    if (rec) {
      rec.status = STATUS[j.status] ?? rec.status;
      saveJob(rec);
    }
    return rec;
  }

  status() {
    return { robot: this.id, wallet: this.wallet, robotAddress: this.robotAddress, spentToday: formatEther(spentToday(this.id)), openJobs: openJobCount(this.id) };
  }

  // ---------------- helpers ----------------

  private call(action: Action, args: readonly unknown[], reason?: string) {
    return sendTx({ wallet: this.wallet, robot: this.id, action, reason, to: CORE_ADDRESS, abi: CORE_ABI, functionName: action, args });
  }

  private refund(jobId: string, kind: string) {
    const job = getJobRecord(jobId);
    if (job) recordSpend(this.id, jobId, -BigInt(job.payout), kind);
  }

  private update(jobId: string, patch: Partial<JobRecord>, action: string, tx: TxResult) {
    const job = getJobRecord(jobId);
    if (!job) return; // job not posted by us (e.g. older run): chain is still the source of truth
    Object.assign(job, patch);
    job.txs.push({ action, hash: tx.hash, link: tx.link });
    saveJob(job);
  }
}

function jobIdFrom(receipt: TransactionReceipt, eventName: string): string {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CORE_ADDRESS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: CORE_ABI, data: log.data, topics: log.topics });
      if (ev.eventName === eventName) return String((ev.args as unknown as { jobId: bigint }).jobId);
    } catch {
      /* not ours */
    }
  }
  throw new Error(`${eventName} event not found in ${receipt.transactionHash}`);
}
