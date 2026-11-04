// Monaid Agents API — request/response types (v1). Source of truth for the bridge and portal.
// Human docs with curl examples: docs/agents-api.md. All MON amounts are decimal strings ("0.01").

export type EventKind = "claim" | "power_on" | "power_off" | "beacon_seen" | "knob" | "key" | "crash";

/** POST /events — the bridge forwards one device event. robotId comes from the MQTT topic, never the payload. */
export type EventRequest = {
  robotId: string;
  kind: EventKind;
  seq: number; // strictly increasing per robot; seq <= last accepted → 409 STALE_SEQ
  ts: number; // device unix seconds
  data?: {
    level?: "normal" | "urgent"; // crash only: picks the payout tier (0.01 / 0.03 MON). Never an amount.
    worker?: string; // claim only: worker ID from the registry
    [k: string]: unknown; // anything else is recorded as untrusted data
  };
};

export type EventAction =
  | "job_posted" // trouble event → job posted on-chain
  | "pending_approval" // trouble event, payout above the owner-approval threshold → waiting for the owner
  | "claim_accepted" // claim event → worker recorded on-chain
  | "job_settled" // proof event → worker paid
  | "ignored"; // nothing to do (no matching job, job already open, kind not used by the core)

export type TxRef = { hash: string; link: string };

export type EventResponse = {
  ok: true;
  robotId: string;
  seq: number;
  action: EventAction;
  jobId?: string;
  approvalId?: string;
  worker?: string;
  payout?: string;
  tx?: TxRef;
  note?: string;
};

/** POST /jobs/:id/claim */
export type ClaimRequest = { worker: string }; // worker ID, e.g. "demo-1"
export type ClaimResponse = { ok: true; jobId: string; robotId: string; worker: string; workerAddress: string; claimDeadline: number; tx: TxRef };

/** POST /owner/decide — the owner's pick when Muse is slow (or the "owner decides" button). */
export type DecideRequest = { approvalId: string; decision: "approve" | "reject" };
export type DecideResponse = { ok: true; approvalId: string; decision: "approve" | "reject"; jobId?: string; tx?: TxRef };

/** POST /admin/kill */
export type KillRequest = { engaged: boolean; reason?: string };
export type KillResponse = { ok: true; engaged: boolean; reason: string; since: string | null };

export type JobStatus = "Open" | "Claimed" | "Settled" | "Expired" | "Cancelled";

/** GET /jobs[?robotId=1] */
export type Job = {
  jobId: string;
  robotId: string;
  status: JobStatus;
  payout: string;
  claimWindow: number;
  worker?: string; // worker ID if registered, else address
  workerAddress?: string;
  claimDeadline?: number;
  postedAt: string;
  txs: { action: string; hash: string; link: string }[];
};
export type JobsResponse = { ok: true; jobs: Job[] };

/** GET /robots */
export type Robot = {
  robotId: string;
  robotAddress: string;
  agent: string;
  agentAddress: string;
  agentBalance: string; // MON in the agent's gas wallet
  balance: string; // robot's free balance in MonaidCore
  escrow: string; // locked in open/claimed jobs
  openJobs: number;
  spentToday: string;
  lastSeq: number | null;
  lastEventAt: string | null;
};
export type RobotsResponse = { ok: true; core: string; killSwitch: KillResponse; robots: Robot[] };

/** GET /approvals[?status=pending] */
export type Approval = { id: string; robot: string; action: string; summary: string; reason?: string; createdAt: string; status: "pending" | "approved" | "rejected" };
export type ApprovalsResponse = { ok: true; approvals: Approval[] };

/** GET /workers */
export type WorkersResponse = { ok: true; workers: { id: string; address: string }[] };

/** Every error. */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "UNKNOWN_ROBOT"
  | "UNKNOWN_WORKER"
  | "UNKNOWN_JOB"
  | "STALE_SEQ"
  | "BLOCKED"
  | "KILL_SWITCH"
  | "REVERTED"
  | "REFUSED"
  | "INTERNAL";
export type ErrorResponse = { ok: false; error: ErrorCode; message: string; code?: string; link?: string };

/** GET /feed — Server-Sent Events, one JSON object per `data:` line. */
export type FeedEvent = {
  time: string;
  type:
    | "hello"
    | "event" // a device event was accepted
    | "job_posted"
    | "job_claimed"
    | "job_settled"
    | "job_expired"
    | "job_cancelled"
    | "approval_requested"
    | "approval_decided"
    | "blocked"
    | "kill_switch"
    | "muse_decision" // Muse answered or fell back: { question, source, choice?, reason?, fallback?, detail?, ms }
    | "tx"; // every transaction attempt (result: success | reverted | refused | blocked | out-of-gas | error)
  robot?: string;
  [k: string]: unknown;
};

// ---------------- Muse (P7) ----------------

/** POST /muse/decide — approval mode: Muse picks approve/reject for a pending approval and we apply it. */
export type MuseApprovalRequest = { approvalId: string };
/** POST /muse/decide — advice mode: Muse picks one of the given options; nothing is applied. */
export type MuseAdviceRequest = {
  question: string; // max 300 chars
  options: { id: string; label: string; detail?: string }[]; // 2–8; id: lowercase a-z0-9_-, max 32
};

export type MuseResult =
  | { source: "muse"; choice: string; reason: string; ms: number; model: string }
  | { source: "owner_decides"; fallback: "no_api_key" | "timeout" | "invalid_output" | "refusal" | "api_error"; detail: string; ms: number };

export type MuseApprovalResponse = {
  ok: true;
  mode: "approval";
  approvalId: string;
  muse: MuseResult;
  /** null when Muse fell back (approval stays pending). Otherwise the result of applying Muse's pick. */
  applied: DecideResponse | { ok: false; error: string; message: string } | null;
  note?: string;
};
export type MuseAdviceResponse = { ok: true; mode: "advice"; muse: MuseResult };
