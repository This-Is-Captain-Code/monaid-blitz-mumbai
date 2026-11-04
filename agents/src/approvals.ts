// Owner-approval queue. Actions above a robot's ownerApprovalAbove wait here until the owner approves or rejects
// ("owner decides"). Approving re-runs the action through every other guardrail and the kill switch.
// In memory for now; the Agents API (P6) exposes list/approve/reject.
import { randomUUID } from "node:crypto";
import { bus } from "./bus.js";

export type Approval = {
  id: string;
  robot: string;
  action: string;
  summary: string; // human-readable, e.g. "postJob 0.03 MON, window 300 s"
  reason?: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  decidedAt?: string;
  result?: unknown;
};

const queue = new Map<string, { approval: Approval; run: () => Promise<unknown> }>();

export function requestApproval(a: Omit<Approval, "id" | "createdAt" | "status">, run: () => Promise<unknown>): Approval {
  const approval: Approval = { ...a, id: randomUUID().slice(0, 8), createdAt: new Date().toISOString(), status: "pending" };
  queue.set(approval.id, { approval, run });
  bus.emit("feed", { type: "approval_requested", robot: a.robot, approval });
  return approval;
}

export const listApprovals = (status?: Approval["status"]) =>
  [...queue.values()].map((q) => q.approval).filter((a) => !status || a.status === status);

/** Owner approves: the action runs now (still subject to every other guardrail). */
export async function approve(id: string): Promise<unknown> {
  const q = queue.get(id);
  if (!q) throw new Error(`No approval ${id}`);
  if (q.approval.status !== "pending") throw new Error(`Approval ${id} is already ${q.approval.status}`);
  q.approval.status = "approved";
  q.approval.decidedAt = new Date().toISOString();
  bus.emit("feed", { type: "approval_decided", robot: q.approval.robot, id, decision: "approved" });
  q.approval.result = await q.run();
  return q.approval.result;
}

export function reject(id: string): Approval {
  const q = queue.get(id);
  if (!q) throw new Error(`No approval ${id}`);
  if (q.approval.status !== "pending") throw new Error(`Approval ${id} is already ${q.approval.status}`);
  q.approval.status = "rejected";
  q.approval.decidedAt = new Date().toISOString();
  bus.emit("feed", { type: "approval_decided", robot: q.approval.robot, id, decision: "rejected" });
  return q.approval;
}
