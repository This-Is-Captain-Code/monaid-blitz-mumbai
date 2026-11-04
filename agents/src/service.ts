// The agents service: one RobotAgent per configured robot, the event → action rules, the expiry watcher.
// The HTTP layer (src/api.ts) is a thin wrapper around this.
import { formatEther, parseEther } from "viem";
import { account } from "./env.js";
import { CORE_ABI, CORE_ADDRESS, config, publicClient } from "./chain.js";
import { bus } from "./bus.js";
import { RobotAgent } from "./robot-agent.js";
import { approve, listApprovals, reject } from "./approvals.js";
import { engageKillSwitch, killSwitch, releaseKillSwitch } from "./killswitch.js";
import { getJobRecord, listJobs, saveJob, spentToday, type JobRecord } from "./ledger.js";
import { resolveWorker, workerIdOf, workers } from "./workers.js";
import type { TxResult } from "./tx.js";
import { museDecide } from "./muse.js";

const JOBS_CFG = (config as unknown as {
  jobs: {
    payouts: Record<string, string>;
    claimWindowSec: number;
    troubleKinds: string[];
    claimKinds: string[];
    clickWorker: string;
    proofKinds: Record<string, string[]>; // trigger kind → kinds that prove the fix after the claim
    expiryCheckMs: number;
  };
}).jobs;

// Kinds the bridge sends (server/bridge/README.md) plus the earlier draft kinds.
export const EVENT_KINDS = [
  "heartbeat", "down", "up", "crash", "recover", "click", "knob", "claim", "power",
  "power_on", "power_off", "beacon_seen", "key",
] as const;
const QUIET_KINDS = new Set(["heartbeat", "knob"]); // not echoed on the feed (every 10 s per device)

/** Screen states the device firmware knows (free text ≤ 15 chars). */
const SCREEN: Record<string, string> = {
  job_posted: "JOB OPEN",
  approval_requested: "BIDDING",
  job_claimed: "CLAIMED",
  job_settled: "PAID",
  job_expired: "BLOCKED",
  job_cancelled: "IDLE",
};

/** An API-level error with an HTTP status and a stable code (see shared/api-types.ts ErrorCode). */
export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

const txRef = (t: TxResult) => ({ hash: t.hash, link: t.link });

// ---- duplicate dropping: same robot + kind + seq + data within 60 s (QoS 1 redelivery) ----
// Device seq is per boot (resets on reboot) and the bridge sends seq 0 for broker up/down, so we don't
// require increasing seqs; we only drop exact repeats.
const DEDUPE_MS = 60_000;

export class MonaidService {
  readonly agents = new Map<string, RobotAgent>();
  private recent = new Map<string, number>(); // dedupe key → time seen
  private lastEvent: Record<string, { seq: number; at: string }> = {};
  private expiring = new Set<string>();
  private watcher?: ReturnType<typeof setInterval>;

  constructor() {
    for (const r of config.robots) this.agents.set(r.id, new RobotAgent(r.id));
    workers(); // load + validate the registry at startup
    // Screen lines in the bridge's format, to BOTH devices: {robotId: <bridge number>, screen: {...}}.
    bus.on("feed", (e) => {
      const state = SCREEN[e.type];
      if (!state || !e.robot || e.type === "screen") return;
      const job = typeof e.jobId === "string" ? getJobRecord(e.jobId) : undefined;
      const payout = job ? `${formatEther(BigInt(job.payout))} MON` : "";
      const worker = job?.worker ? (workerIdOf(job.worker) ?? job.worker).toUpperCase() : "";
      for (const r of config.robots) {
        const robotId = r.bridgeId ?? r.id;
        const out = (screen: Record<string, unknown>) => bus.emit("feed", { type: "screen", robot: e.robot, robotId, screen });
        out({ state });
        if (job && (e.type === "job_posted" || e.type === "job_claimed")) out({ cmd: "job", id: Number(job.jobId), payout, worker });
        if (e.type === "job_settled") out({ say: `paid ${payout} to ${worker}`.slice(0, 40) });
        if (e.type === "job_expired") out({ say: "no fix in time" });
      }
    });
  }

  /** Accepts the robot id (MQTT username, e.g. "tdeck-01") or the bridge's number (1, "1"). */
  agent(robotId: unknown): RobotAgent {
    const key = typeof robotId === "number" || typeof robotId === "string" ? String(robotId) : "";
    const id = this.agents.has(key) ? key : config.robots.find((r) => r.bridgeId !== undefined && String(r.bridgeId) === key)?.id;
    const a = id ? this.agents.get(id) : undefined;
    if (!a) {
      const known = config.robots.map((r) => (r.bridgeId !== undefined ? `${r.id} (${r.bridgeId})` : r.id)).join(", ");
      throw new ApiError(404, "UNKNOWN_ROBOT", `Unknown robot "${String(robotId).slice(0, 40)}". Known: ${known}`);
    }
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

    // Drop exact repeats (same robot, kind, seq, data within 60 s) — recorded BEFORE acting, so a redelivered
    // event can never trigger an action twice. Reply 200 so the bridge doesn't treat it as an error.
    const base = { ok: true as const, robotId: agent.id, seq: seq as number };
    const now = Date.now();
    for (const [k, t] of this.recent) if (now - t > DEDUPE_MS) this.recent.delete(k);
    const key = JSON.stringify([agent.id, kind, seq, data]);
    if (this.recent.has(key)) return { ...base, action: "ignored" as const, note: "duplicate (same robot, kind, seq, data within 60 s)" };
    this.recent.set(key, now);
    this.lastEvent[agent.id] = { seq: seq as number, at: new Date().toISOString() };
    if (!QUIET_KINDS.has(kind)) bus.emit("feed", { type: "event", robot: agent.id, kind, seq, ts });

    const open = this.activeJob(agent.id);

    if (JOBS_CFG.troubleKinds.includes(kind)) {
      if (open) return { ...base, action: "ignored" as const, jobId: open.jobId, note: `robot ${agent.id} already has job ${open.jobId} (${open.status})` };
      const tier = data.level === "urgent" ? "urgent" : "normal";
      const payout = parseEther(JOBS_CFG.payouts[tier]);
      const r = await agent.postJob({ payout, claimWindow: JOBS_CFG.claimWindowSec, reason: `${kind} event seq ${seq} (${tier})` });
      if (r.status === "pending_approval") {
        return { ...base, action: "pending_approval" as const, approvalId: r.approval.id, payout: formatEther(payout), note: r.approval.summary };
      }
      const rec = getJobRecord(r.jobId);
      if (rec) saveJob({ ...rec, trigger: kind });
      return { ...base, action: "job_posted" as const, jobId: r.jobId, payout: r.payout, tx: txRef(r.tx) };
    }

    if (JOBS_CFG.claimKinds.includes(kind)) {
      // T-Deck types the worker id (data.text); data.worker also accepted; a Watcher click uses the configured worker.
      const raw = data.worker ?? data.text ?? (kind === "click" ? JOBS_CFG.clickWorker : undefined);
      let worker: { id: string; address: `0x${string}` };
      try {
        worker = resolveWorker(typeof raw === "string" ? raw.trim().toLowerCase() : raw);
      } catch {
        const robotId = config.robots.find((r) => r.id === agent.id)?.bridgeId ?? agent.id;
        bus.emit("feed", { type: "screen", robot: agent.id, robotId, screen: { say: "UNKNOWN WORKER" } });
        return { ...base, action: "ignored" as const, note: `unknown worker "${String(raw).slice(0, 32)}"` };
      }
      // A claim applies to the oldest open job on ANY robot (typed on whichever device is at hand).
      const target = this.oldestOpenJob();
      if (!target) return { ...base, action: "ignored" as const, note: "no open job to claim" };
      const tx = await this.agent(target.robot).acceptClaim(target.jobId, worker.address, `${kind} on ${agent.id} seq ${seq} by ${worker.id}`);
      return { ...base, action: "claim_accepted" as const, jobId: target.jobId, worker: worker.id, tx: txRef(tx), ...(target.robot !== agent.id ? { note: `claimed robot ${target.robot}'s job` } : {}) };
    }

    if (open?.status === "Claimed") {
      const proofs = JOBS_CFG.proofKinds[open.trigger ?? ""] ?? Object.values(JOBS_CFG.proofKinds).flat();
      const isProof = proofs.includes(kind) && !(kind === "power" && data.on !== true);
      if (isProof) {
        const tx = await agent.settleOnProof(open.jobId, { kind, seq, ts, data }, `${kind} after claim = proof (${open.trigger ?? "job"})`);
        return { ...base, action: "job_settled" as const, jobId: open.jobId, worker: workerIdOf(open.worker) ?? open.worker, payout: formatEther(BigInt(open.payout)), tx: txRef(tx) };
      }
    }

    return { ...base, action: "ignored" as const, note: open ? `${kind}: no action for job ${open.jobId} (${open.status})` : `${kind}: nothing to do` };
  }

  private oldestOpenJob(): JobRecord | undefined {
    return listJobs()
      .filter((j) => j.status === "Open" && this.agents.has(j.robot))
      .sort((a, b) => Number(a.jobId) - Number(b.jobId))[0];
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

  // ---------------- POST /muse/decide ----------------

  /**
   * Approval mode `{ approvalId }`: Muse picks approve/reject for a pending approval; the pick is applied through
   * decide() — every guardrail and the kill switch still apply. Fallback → the approval stays pending (owner decides).
   * Advice mode `{ question, options }`: Muse only returns a choice; nothing is applied.
   */
  async museDecide(body: Record<string, unknown>) {
    if (typeof body.approvalId === "string") {
      const a = listApprovals().find((x) => x.id === body.approvalId);
      if (!a) throw new ApiError(404, "NOT_FOUND", `No approval ${body.approvalId}`);
      if (a.status !== "pending") throw new ApiError(409, "BAD_REQUEST", `Approval ${a.id} is already ${a.status}`);
      const muse = await museDecide({
        question: `Robot ${a.robot} wants to ${a.summary}, which is above the owner-approval threshold. Approve it?`,
        options: [
          { id: "approve", label: `Approve: ${a.summary}`, detail: a.reason ? `trigger: ${a.reason}`.slice(0, 300) : undefined },
          { id: "reject", label: "Reject: keep the MON; the robot waits for the owner" },
        ],
      });
      if (muse.source !== "claude") {
        return { ok: true as const, mode: "approval" as const, approvalId: a.id, claude: muse, applied: null, note: "Claude fell back: the approval stays pending — owner decides (POST /owner/decide)" };
      }
      try {
        const applied = await this.decide({ approvalId: a.id, decision: muse.choice });
        return { ok: true as const, mode: "approval" as const, approvalId: a.id, claude: muse, applied };
      } catch (e) {
        // Muse's pick still had to pass every guardrail; report what stopped it.
        return { ok: true as const, mode: "approval" as const, approvalId: a.id, claude: muse, applied: { ok: false as const, error: (e as Error).name, message: (e as Error).message } };
      }
    }
    try {
      const muse = await museDecide({ question: body.question, options: body.options });
      return { ok: true as const, mode: "advice" as const, claude: muse };
    } catch (e) {
      throw new ApiError(400, "BAD_REQUEST", `decision: ${(e as Error).message}`);
    }
  }

  // ---------------- POST /admin/kill ----------------

  kill(body: Record<string, unknown>) {
    if (typeof body.engaged !== "boolean") throw new ApiError(400, "BAD_REQUEST", "engaged must be true or false");
    if (body.engaged) engageKillSwitch(typeof body.reason === "string" ? body.reason.slice(0, 200) : "engaged via API");
    else releaseKillSwitch();
    return { ok: true as const, ...killSwitch() };
  }

  // ---------------- POST /admin/reset-seq (rehearsals: forget recent events so nothing is treated as a duplicate) ----------------

  resetSeq(body: Record<string, unknown>) {
    const ids = body.robotId === undefined ? [...this.agents.keys()] : [this.agent(body.robotId).id];
    for (const k of [...this.recent.keys()]) if (ids.includes(JSON.parse(k)[0])) this.recent.delete(k);
    bus.emit("feed", { type: "seq_reset", robots: ids });
    return { ok: true as const, reset: ids };
  }

  // ---------------- reads ----------------

  jobs(robotId?: string) {
    const id = robotId !== undefined ? this.agent(robotId).id : undefined;
    return listJobs(id)
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
          lastSeq: this.lastEvent[a.id]?.seq ?? null,
          lastEventAt: this.lastEvent[a.id]?.at ?? null,
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
