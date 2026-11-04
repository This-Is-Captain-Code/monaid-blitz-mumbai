// Off-chain guardrails, layer 2 (MonaidCore's on-chain rules are layer 1).
// evaluate() is pure so it can be unit-tested; RobotAgent feeds it the live counters.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, parseEther } from "viem";
import { AGENTS_DIR } from "./env.js";

export type Action = "postJob" | "claim" | "settle" | "expire" | "cancel";

export type Policy = {
  maxPayoutPerJob: bigint;
  maxSpendPerDay: bigint;
  maxOpenJobs: number;
  ownerApprovalAbove: bigint;
  allowedActions: Action[];
};

type RawPolicy = Partial<{
  maxPayoutPerJob: string;
  maxSpendPerDay: string;
  maxOpenJobs: number;
  ownerApprovalAbove: string;
  allowedActions: Action[];
}>;

export const POLICY_PATH = join(AGENTS_DIR, "policy.json");

export function parsePolicy(raw: RawPolicy, defaults: RawPolicy = {}): Policy {
  const r = { ...defaults, ...raw };
  const need = <T>(v: T | undefined, k: string): T => {
    if (v === undefined) throw new Error(`policy.json: missing ${k}`);
    return v;
  };
  return {
    maxPayoutPerJob: parseEther(need(r.maxPayoutPerJob, "maxPayoutPerJob")),
    maxSpendPerDay: parseEther(need(r.maxSpendPerDay, "maxSpendPerDay")),
    maxOpenJobs: need(r.maxOpenJobs, "maxOpenJobs"),
    ownerApprovalAbove: parseEther(need(r.ownerApprovalAbove, "ownerApprovalAbove")),
    allowedActions: need(r.allowedActions, "allowedActions"),
  };
}

/** Policy for one robot from agents/policy.json (robot entry merged over defaults). */
export function loadPolicy(robotId: string): Policy {
  const file = JSON.parse(readFileSync(POLICY_PATH, "utf8")) as { defaults: RawPolicy; robots: Record<string, RawPolicy> };
  const raw = file.robots[robotId];
  if (!raw) throw new Error(`policy.json has no entry for robot "${robotId}"`);
  return parsePolicy(raw, file.defaults);
}

export type BlockCode = "ACTION_NOT_ALLOWED" | "PAYOUT_ABOVE_POLICY" | "DAILY_CAP" | "TOO_MANY_OPEN_JOBS";

export type Verdict =
  | { ok: true }
  | { ok: false; code: BlockCode; message: string }
  | { ok: "needs_approval"; message: string };

const mon = (wei: bigint) => `${formatEther(wei)} MON`;

/**
 * Pure policy check. `approved` = the owner already approved this exact action (skips only the approval threshold;
 * every other rule still applies).
 */
export function evaluate(
  policy: Policy,
  ctx: { robotId: string; action: Action; payout?: bigint; spentToday: bigint; openJobs: number; approved?: boolean },
): Verdict {
  const { robotId, action } = ctx;
  if (!policy.allowedActions.includes(action)) {
    return { ok: false, code: "ACTION_NOT_ALLOWED", message: `${action} is not allowed for robot ${robotId}` };
  }
  if (action !== "postJob") return { ok: true };

  const payout = ctx.payout ?? 0n;
  if (payout > policy.maxPayoutPerJob) {
    return {
      ok: false,
      code: "PAYOUT_ABOVE_POLICY",
      message: `payout ${mon(payout)} > robot ${robotId} maxPayoutPerJob ${mon(policy.maxPayoutPerJob)}`,
    };
  }
  if (ctx.spentToday + payout > policy.maxSpendPerDay) {
    return {
      ok: false,
      code: "DAILY_CAP",
      message: `robot ${robotId} spent ${mon(ctx.spentToday)} today; +${mon(payout)} > maxSpendPerDay ${mon(policy.maxSpendPerDay)}`,
    };
  }
  if (ctx.openJobs >= policy.maxOpenJobs) {
    return { ok: false, code: "TOO_MANY_OPEN_JOBS", message: `robot ${robotId} has ${ctx.openJobs} open jobs (max ${policy.maxOpenJobs})` };
  }
  if (payout > policy.ownerApprovalAbove && !ctx.approved) {
    return { ok: "needs_approval", message: `payout ${mon(payout)} > ownerApprovalAbove ${mon(policy.ownerApprovalAbove)}: waiting for the owner` };
  }
  return { ok: true };
}
