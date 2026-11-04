// The agents service: one RobotAgent per configured robot, the event → action rules, the expiry watcher.
// The HTTP layer (src/api.ts) is a thin wrapper around this.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, parseEther } from "viem";
import { AGENTS_DIR, account } from "./env.js";
import { CORE_ABI, CORE_ADDRESS, config, publicClient } from "./chain.js";
import { bus } from "./bus.js";
import { RobotAgent } from "./robot-agent.js";
import { approve, listApprovals, reject } from "./approvals.js";
import { engageKillSwitch, killSwitch, releaseKillSwitch } from "./killswitch.js";
import { getJobRecord, listJobs, spentToday, type JobRecord } from "./ledger.js";
import { resolveWorker, workerIdOf, workers } from "./workers.js";
import type { TxResult } from "./tx.js";

const JOBS_CFG = (config as unknown as {
  jobs: { payouts: Record<string, string>; claimWindowSec: number; troubleKinds: string[]; proofKinds: string[]; expiryCheckMs: number };
}).jobs;

export const EVENT_KINDS = ["claim", "power_on", "power_off", "beacon_seen", "knob", "key", "crash"] as const;

/** An API-level error with an HTTP status and a stable code (see shared/api-types.ts ErrorCode). */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const txRef = (t: TxResult) => ({ hash: t.hash, link: t.link });

// ---- per-robot sequence numbers (persisted so a restart doesn't accept replays) ----
const SEQ_FILE = join(AGENTS_DIR, "logs", "seq.json");
type SeqState = Record<string, { lastSeq: number; lastEventAt: string }>;
const readSeq = (): SeqState => (existsSync(SEQ_FILE) ? JSON.parse(readFileSync(SEQ_FILE, "utf8")) : {});
function writeSeq(s: SeqState) {
  mkdirSync(join(AGENTS_DIR, "logs"), { recursive: true });
  writeFileSync(SEQ_FILE, JSON.stringify(s, null, 2));
}

export class MonaidService {
  readonly agents = new Map<string, RobotAgent>();
  private seq: SeqState = readSeq();
  private expiring = new Set<string>();
  private watcher?: ReturnType<typeof setInterval>;

  constructor() {
    for (const r of config.robots) this.agents.set(r.id, new RobotAgent(r.id));
    workers(); // load + validate the registry at startup
  }

  agent(robotId: unknown): RobotAgent {
    const a = typeof robotId === "string" ? this.agents.get(robotId) : undefined;
    if (!a) throw new ApiError(404, "UNKNOWN_ROBOT", `Unknown robot "${String(robotId).slice(0, 40)}". Known: ${[...this.agents.keys()].join(", ")}`);
    return a;
  }

  // ---------------- POST /events ----------------

  async handleEvent(body: Record<string, unknown>) {
    const { robotId, kind, seq, ts } = body;
    const data = (body.data ?? {}) as Record<string, unknown>;
    const agent = this.agent(robotId);
    if (typeof kind !== "string" || !(EVENT_KINDS as readonly string[]).includes(kind)) {
      throw new ApiError(400, "BAD_REQUEST", `kind must be one of: ${EVENT_KINDS.join(", ")}`);
    }
    if (!Number.isSafeInteger(seq) || (seq as number) < 0) throw new ApiError(400, "BAD_REQUEST", "seq must be a non-negative integer");
    if (!Number.isSafeInteger(ts) || (ts as number) < 0) throw new ApiError(400, "BAD_REQUEST", "ts must be unix seconds (integer)");
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new ApiError(400, "BAD_REQUEST", "data must be an object");

    const last = this.seq[agent.id]?.lastSeq;
    if (last !== undefined && (seq as number) <= last) {
      throw new ApiError(409, "STALE_SEQ", `seq ${seq} <= last accepted ${last} for robot ${agent.id} (duplicate or replay)`);
    }
    // Accept the seq BEFORE acting, so a retried request can never trigger the action twice.
    this.seq[agent.id] = { lastSeq: seq as number, lastEventAt: new Date().toISOString() };
    writeSeq(this.seq);
    bus.emit("feed", { type: "event", robot: agent.id, kind, seq, ts });

    const base = { ok: true as const, robotId: agent.id, seq: seq as number };
    const open = this.activeJob(agent.id);

    if (JOBS_CFG.troubleKinds.includes(kind)) {
      if (open) return { ...base, action: "ignored" as const, jobId: open.jobId, note: `robot ${agent.id} already has job ${open.jobId} (${open.status})` };
      const tier = data.level === "urgent" ? "urgent" : "normal";
      const payout = parseEther(JOBS_CFG.payouts[tier]);
      const r = await agent.postJob({ payout, claimWindow: JOBS_CFG.claimWindowSec, reason: `${kind} event seq ${seq} (${tier})` });
      if (r.status === "pending_approval") {
        return { ...base, action: "pending_approval" as const, approvalId: r.approval.id, payout: formatEther(payout), note: r.approval.summary };
      }
      return { ...base, action: "job_posted" as const, jobId: r.jobId, payout: r.payout, tx: txRef(r.tx) };
    }

    if (kind === "claim") {
      const worker = resolveWorker(data.worker); // throws UNKNOWN_WORKER
      if (!open || open.status !== "Open") {
        return { ...base, action: "ignored" as const, note: `robot ${agent.id} has no open job to claim` };
      }
      const tx = await agent.acceptClaim(open.jobId, worker.address, `claim event seq ${seq} by ${worker.id}`);
      return { ...base, action: "claim_accepted" as const, jobId: open.jobId, worker: worker.id, tx: txRef(tx) };
    }

    if (JOBS_CFG.proofKinds.includes(kind)) {
      if (!open || open.status !== "Claimed") {
        return { ...base, action: "ignored" as const, note: `robot ${agent.id} has no claimed job; ${kind} is not a proof right now` };
      }
      const tx = await agent.settleOnProof(open.jobId, { kind, seq, ts, data }, `${kind} event seq ${seq} = proof`);
      return { ...base, action: "job_settled" as const, jobId: open.jobId, worker: workerIdOf(open.worker) ?? open.worker, payout: formatEther(BigInt(open.payout)), tx: txRef(tx) };
    }

    return { ...base, action: "ignored" as const, note: `${kind} has no core action` };
  }

  /** The robot's current job (Open or Claimed), newest first. */
  private activeJob(robotId: string): JobRecord | undefined {
    return listJobs(robotId)
      .filter((j) => j.status === "Open" || j.status === "Claimed")
      .sort((a, b) => Number(b.jobId) - Number(a.jobId))[0];
  }

  // ---------------- POST /jobs/:id/claim ----------------

  async claimJob(jobId: string, body: Record<string, unknown>) {
    if (!/^\d{1,18}$/.test(jobId)) throw new ApiError(400, "BAD_REQUEST", "job id must be a number");
    const job = getJobRecord(jobId);
    if (!job) throw new ApiError(404, "UNKNOWN_JOB", `No job ${jobId} on the current MonaidCore`);
    const worker = resolveWorker(body.worker);
    const agent = this.agent(job.robot);
    const tx = await agent.acceptClaim(jobId, worker.address, `portal claim by ${worker.id}`);
    const rec = getJobRecord(jobId)!;
    return { ok: true as const, jobId, robotId: job.robot, worker: worker.id, workerAddress: worker.address, claimDeadline: rec.claimDeadline ?? 0, tx: txRef(tx) };
  }

  // ---------------- POST /owner/decide ----------------

  async decide(body: Record<string, unknown>) {
    const { approvalId, decision } = body;
    if (typeof approvalId !== "string" || !approvalId) throw new ApiError(400, "BAD_REQUEST", "approvalId required");
    if (decision !== "approve" && decision !== "reject") throw new ApiError(400, "BAD_REQUEST", 'decision must be "approve" or "reject"');
    const a = listApprovals().find((x) => x.id === approvalId);
    if (!a) throw new ApiError(404, "NOT_FOUND", `No approval ${approvalId}`);
    if (a.status !== "pending") throw new ApiError(409, "BAD_REQUEST", `Approval ${approvalId} is already ${a.status}`);
    if (decision === "reject") {
      reject(approvalId);
      return { ok: true as const, approvalId, decision };
    }
    const r = (await approve(approvalId)) as { status: string; jobId?: string; tx?: TxResult };
    return { ok: true as const, approvalId, decision, jobId: r?.jobId, tx: r?.tx ? txRef(r.tx) : undefined };
  }

  // ---------------- POST /admin/kill ----------------

  kill(body: Record<string, unknown>) {
    if (typeof body.engaged !== "boolean") throw new ApiError(400, "BAD_REQUEST", "engaged must be true or false");
    if (body.engaged) engageKillSwitch(typeof body.reason === "string" ? body.reason.slice(0, 200) : "engaged via API");
    else releaseKillSwitch();
    return { ok: true as const, ...killSwitch() };
  }

  // ---------------- POST /admin/reset-seq (rehearsals: let a device start counting from 0 again) ----------------

  resetSeq(body: Record<string, unknown>) {
    const ids = body.robotId === undefined ? [...this.agents.keys()] : [this.agent(body.robotId).id];
    for (const id of ids) delete this.seq[id];
    writeSeq(this.seq);
    bus.emit("feed", { type: "seq_reset", robots: ids });
    return { ok: true as const, reset: ids };
  }

  // ---------------- reads ----------------

  jobs(robotId?: string) {
    if (robotId !== undefined) this.agent(robotId);
    return listJobs(robotId)
      .sort((a, b) => Number(b.jobId) - Number(a.jobId))
      .map((j) => ({
        jobId: j.jobId,
        robotId: j.robot,
        status: j.status,
        payout: formatEther(BigInt(j.payout)),
        claimWindow: j.claimWindow,
        worker: workerIdOf(j.worker) ?? j.worker,
        workerAddress: j.worker,
        claimDeadline: j.claimDeadline,
        postedAt: j.postedAt,
        txs: j.txs,
      }));
  }

  async robots() {
    const read = (functionName: string, a: string) =>
      publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName, args: [a] }) as Promise<bigint>;
    const robots = await Promise.all(
      [...this.agents.values()].map(async (a) => {
        const agentAddress = account(a.wallet).address;
        const [agentBal, bal, escrow] = await Promise.all([publicClient.getBalance({ address: agentAddress }), read("balanceOf", a.robotAddress), read("escrowOf", a.robotAddress)]);
        const s = a.status();
        return {
          robotId: a.id,
          robotAddress: a.robotAddress,
          agent: a.wallet,
          agentAddress,
          agentBalance: formatEther(agentBal),
          balance: formatEther(bal),
          escrow: formatEther(escrow),
          openJobs: s.openJobs,
          spentToday: formatEther(spentToday(a.id)),
          lastSeq: this.seq[a.id]?.lastSeq ?? null,
          lastEventAt: this.seq[a.id]?.lastEventAt ?? null,
        };
      }),
    );
    return { ok: true as const, core: CORE_ADDRESS, killSwitch: { ok: true as const, ...killSwitch() }, robots };
  }

  approvals(status?: string) {
    const s = status === "pending" || status === "approved" || status === "rejected" ? status : undefined;
    return { ok: true as const, approvals: listApprovals(s).map(({ result: _r, ...a }) => a) };
  }

  workerList() {
    return { ok: true as const, workers: [...workers()].map(([id, address]) => ({ id, address })) };
  }

  // ---------------- expiry watcher (fail path) ----------------

  /** Expires claimed jobs whose window has passed. Anyone could; our agent does it for its own robots. */
  startExpiryWatcher() {
    if (this.watcher) return;
    this.watcher = setInterval(() => void this.expireDue(), JOBS_CFG.expiryCheckMs);
  }

  stopExpiryWatcher() {
    if (this.watcher) clearInterval(this.watcher);
    this.watcher = undefined;
  }

  private async expireDue() {
    if (killSwitch().engaged) return;
    const now = Math.floor(Date.now() / 1000);
    for (const j of listJobs()) {
      if (j.status !== "Claimed" || !j.claimDeadline || now <= j.claimDeadline + 1 || this.expiring.has(j.jobId)) continue;
      const agent = this.agents.get(j.robot);
      if (!agent) continue;
      this.expiring.add(j.jobId);
      try {
        await agent.expire(j.jobId, `claim window passed (deadline ${j.claimDeadline})`);
      } catch (e) {
        // Chain clock may lag a second: ClaimNotExpired is refused locally (no gas) and retried next tick.
        if (!/ClaimNotExpired/.test(String((e as Error).message))) console.warn(`expiry watcher: job ${j.jobId}: ${(e as Error).message}`);
      } finally {
        this.expiring.delete(j.jobId);
      }
    }
  }
}
