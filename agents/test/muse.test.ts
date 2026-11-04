// Offline: Muse's validation and fallbacks, with a fake model call (no API key, no network).  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { museDecide, validateDecision, type ModelCall } from "../src/muse.js";

const decision = {
  question: "Which robot gets help first?",
  options: [
    { id: "robot-1", label: "T-Deck (demo at 15:00)" },
    { id: "robot-2", label: "Watcher (patrol at 16:30)" },
  ],
};
const fake = (out: Awaited<ReturnType<ModelCall>>, delayMs = 0): ModelCall => async () => {
  await new Promise((r) => setTimeout(r, delayMs));
  return out;
};

test("valid pick → source muse with choice and reason", async () => {
  const r = await museDecide(decision, fake({ choice: "robot-1", reason: "The demo at 15:00 depends on it.", model: "fake" }), { requireKey: false });
  assert.equal(r.source, "muse");
  assert.equal(r.source === "muse" && r.choice, "robot-1");
});

test("choice outside the options → owner decides (invalid_output)", async () => {
  const r = await museDecide(decision, fake({ choice: "robot-3", reason: "x", model: "fake" }), { requireKey: false });
  assert.deepEqual([r.source, r.source === "owner_decides" && r.fallback], ["owner_decides", "invalid_output"]);
});

test("empty reason → owner decides (invalid_output)", async () => {
  const r = await museDecide(decision, fake({ choice: "robot-1", reason: "  ", model: "fake" }), { requireKey: false });
  assert.equal(r.source === "owner_decides" && r.fallback, "invalid_output");
});

test("refusal → owner decides", async () => {
  const r = await museDecide(decision, fake({ refusal: true }), { requireKey: false });
  assert.equal(r.source === "owner_decides" && r.fallback, "refusal");
});

test("slower than the timeout → owner decides (timeout)", async () => {
  const r = await museDecide(decision, fake({ choice: "robot-1", reason: "late", model: "fake" }, 300), { requireKey: false, timeoutMs: 50 });
  assert.equal(r.source === "owner_decides" && r.fallback, "timeout");
  assert.ok(r.ms < 250, `fell back after ${r.ms} ms`);
});

test("API / connection error → owner decides (api_error); other throws → invalid_output", async () => {
  const boom: ModelCall = async () => {
    throw new Anthropic.APIConnectionError({ message: "connection reset" });
  };
  const r = await museDecide(decision, boom, { requireKey: false });
  assert.equal(r.source === "owner_decides" && r.fallback, "api_error");
  const parseFail: ModelCall = async () => {
    throw new Error("Failed to parse structured output");
  };
  const r2 = await museDecide(decision, parseFail, { requireKey: false });
  assert.equal(r2.source === "owner_decides" && r2.fallback, "invalid_output");
});

test("no API key → owner decides without calling the model", async () => {
  let called = false;
  const spy: ModelCall = async () => {
    called = true;
    return { choice: "robot-1", reason: "x", model: "fake" };
  };
  const saved = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  const r = await museDecide(decision, spy, { requireKey: true });
  if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
  // agents/.env may hold a key on the owner's laptop; only assert when none is configured anywhere
  if (r.source === "owner_decides") {
    assert.equal(r.fallback, "no_api_key");
    assert.equal(called, false);
  }
});

test("bad decisions are rejected up front (caller error, not a fallback)", () => {
  assert.throws(() => validateDecision({ question: "q", options: [{ id: "a", label: "A" }] }), /2–8 items/);
  assert.throws(() => validateDecision({ question: "q", options: [{ id: "A B", label: "x" }, { id: "b", label: "y" }] }), /lowercase/);
  assert.throws(() => validateDecision({ question: "q", options: [{ id: "a", label: "x" }, { id: "a", label: "y" }] }), /duplicated/);
  assert.equal(validateDecision(decision).options.length, 2);
});
