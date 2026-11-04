// Offline: the off-chain policy rules (pure function, no chain).  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEther } from "viem";
import { evaluate, parsePolicy } from "../src/policy.js";

const policy = parsePolicy({
  maxPayoutPerJob: "0.05",
  maxSpendPerDay: "0.1",
  maxOpenJobs: 2,
  ownerApprovalAbove: "0.02",
  allowedActions: ["postJob", "claim", "settle", "expire", "cancel"],
});
const base = { robotId: "1", spentToday: 0n, openJobs: 0 };
const post = (payout: string, extra: Partial<typeof base & { approved: boolean }> = {}) =>
  evaluate(policy, { ...base, action: "postJob", payout: parseEther(payout), ...extra });

test("within policy and under the approval threshold → ok", () => {
  assert.deepEqual(post("0.01"), { ok: true });
  assert.deepEqual(post("0.02"), { ok: true }); // threshold is "above"
});

test("payout above maxPayoutPerJob → PAYOUT_ABOVE_POLICY (even if approved)", () => {
  assert.equal((post("0.06") as { code: string }).code, "PAYOUT_ABOVE_POLICY");
  assert.equal((post("0.06", { approved: true }) as { code: string }).code, "PAYOUT_ABOVE_POLICY");
});

test("daily cap counts today's spend plus this payout", () => {
  assert.deepEqual(post("0.02", { spentToday: parseEther("0.08") }), { ok: true });
  assert.equal((post("0.02", { spentToday: parseEther("0.09") }) as { code: string }).code, "DAILY_CAP");
});

test("max open jobs", () => {
  assert.deepEqual(post("0.01", { openJobs: 1 }), { ok: true });
  assert.equal((post("0.01", { openJobs: 2 }) as { code: string }).code, "TOO_MANY_OPEN_JOBS");
});

test("above the owner threshold → needs_approval, unless approved", () => {
  assert.equal(post("0.03").ok, "needs_approval");
  assert.deepEqual(post("0.03", { approved: true }), { ok: true });
});

test("allowedActions gates every action", () => {
  const p = parsePolicy({ ...{ maxPayoutPerJob: "0.05", maxSpendPerDay: "0.1", maxOpenJobs: 2, ownerApprovalAbove: "0.02" }, allowedActions: ["postJob"] });
  assert.equal((evaluate(p, { ...base, action: "settle" }) as { code: string }).code, "ACTION_NOT_ALLOWED");
  assert.deepEqual(evaluate(policy, { ...base, action: "settle" }), { ok: true });
});
