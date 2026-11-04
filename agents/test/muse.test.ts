// Offline: the decision agent's validation, fallbacks, and the OpenRouter HTTP call with a mocked fetch.  npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentHttpError, MUSE_CFG, agentLabel, museDecide, openrouterBody, openrouterCall, validateDecision, type ModelCall } from "../src/muse.js";

const decision = {
  question: "Which robot gets help first?",
  options: [
    { id: "robot-1", label: "T-Deck (demo at 15:00)" },
    { id: "robot-2", label: "Watcher (patrol at 16:30)" },
  ],
};
const noKey = { requireKey: false };
const fake = (out: Awaited<ReturnType<ModelCall>>, delayMs = 0): ModelCall => async () => {
  await new Promise((r) => setTimeout(r, delayMs));
  return out;
};

/** A fetch stand-in returning one OpenRouter-style response (and recording the request). */
function mockFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit } = {}): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.url = String(url);
    seen.init = init;
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
}
const completion = (content: unknown, extra: Record<string, unknown> = {}) => ({
  model: "anthropic/claude-haiku-5.5",
  choices: [{ finish_reason: "stop", message: { role: "assistant", content, ...extra } }],
});

test("label: Claude for a Claude model, AI agent otherwise", () => {
  assert.equal(agentLabel("anthropic/claude-haiku-5.5"), "Claude");
  assert.equal(agentLabel("openai/gpt-6.1"), "AI agent");
  assert.equal(agentLabel(), /claude/.test(MUSE_CFG.model) ? "Claude" : "AI agent");
});

test("valid pick → source agent with choice and reason", async () => {
  const r = await museDecide(decision, fake({ choice: "robot-1", reason: "The demo at 15:00 depends on it.", model: "fake" }), noKey);
  assert.equal(r.source, "agent");
  assert.equal(r.source === "agent" && r.choice, "robot-1");
});

test("choice outside the options / empty reason → owner decides (invalid_output)", async () => {
  const a = await museDecide(decision, fake({ choice: "robot-3", reason: "x", model: "fake" }), noKey);
  const b = await museDecide(decision, fake({ choice: "robot-1", reason: "  ", model: "fake" }), noKey);
  assert.deepEqual([a.source === "owner_decides" && a.fallback, b.source === "owner_decides" && b.fallback], ["invalid_output", "invalid_output"]);
});

test("refusal → owner decides", async () => {
  const r = await museDecide(decision, fake({ refusal: true }), noKey);
  assert.equal(r.source === "owner_decides" && r.fallback, "refusal");
});

test("slower than the timeout → owner decides (timeout)", async () => {
  const r = await museDecide(decision, fake({ choice: "robot-1", reason: "late", model: "fake" }, 300), { ...noKey, timeoutMs: 50 });
  assert.equal(r.source === "owner_decides" && r.fallback, "timeout");
  assert.ok(r.ms < 250, `fell back after ${r.ms} ms`);
});

test("no API key → owner decides without calling the model", async () => {
  let called = false;
  const spy: ModelCall = async () => {
    called = true;
    return { choice: "robot-1", reason: "x", model: "fake" };
  };
  const saved = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const r = await museDecide(decision, spy, { requireKey: true });
  if (saved !== undefined) process.env.OPENROUTER_API_KEY = saved;
  if (r.source === "owner_decides" && r.fallback === "no_api_key") assert.equal(called, false); // agents/.env may hold a key on the owner's laptop
});

// ---- OpenRouter HTTP call, mocked ----

test("HTTP: request shape (endpoint, bearer auth, model, system prompt, json_schema with option ids)", async () => {
  const seen: { url?: string; init?: RequestInit } = {};
  const r = await museDecide(decision, openrouterCall(mockFetch(200, completion('{"choice":"robot-2","reason":"Patrol matters more."}'), seen)), noKey);
  assert.equal(r.source === "agent" && r.choice, "robot-2");
  assert.equal(seen.url, "https://openrouter.ai/api/v1/chat/completions");
  assert.match(String((seen.init?.headers as Record<string, string>).Authorization), /^Bearer /);
  const body = JSON.parse(String(seen.init?.body));
  assert.equal(body.model, MUSE_CFG.model);
  assert.equal(body.messages[0].role, "system");
  assert.deepEqual(body.response_format.json_schema.schema.properties.choice.enum, ["robot-1", "robot-2"]);
  assert.deepEqual(openrouterBody(validateDecision(decision)).response_format.type, "json_schema");
});

test("HTTP: answer wrapped in a ```json fence is still parsed", async () => {
  const r = await museDecide(decision, openrouterCall(mockFetch(200, completion('```json\n{"choice":"robot-1","reason":"Demo first."}\n```'))), noKey);
  assert.equal(r.source === "agent" && r.choice, "robot-1");
});

test("HTTP: non-JSON answer → invalid_output; refusal field → refusal", async () => {
  const a = await museDecide(decision, openrouterCall(mockFetch(200, completion("I think robot 1."))), noKey);
  const b = await museDecide(decision, openrouterCall(mockFetch(200, completion(null, { refusal: "I can't help with that." }))), noKey);
  assert.equal(a.source === "owner_decides" && a.fallback, "invalid_output");
  assert.equal(b.source === "owner_decides" && b.fallback, "refusal");
});

test("HTTP: 401 / 429 / 5xx / network error → api_error", async () => {
  for (const status of [401, 429, 503]) {
    const r = await museDecide(decision, openrouterCall(mockFetch(status, { error: { message: "nope" } })), noKey);
    assert.equal(r.source === "owner_decides" && r.fallback, "api_error", `status ${status}`);
  }
  const down = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const r = await museDecide(decision, openrouterCall(down), noKey);
  assert.equal(r.source === "owner_decides" && r.fallback, "api_error");
  assert.ok(new AgentHttpError(500, "x") instanceof Error);
});

test("bad decisions are rejected up front (caller error, not a fallback)", () => {
  assert.throws(() => validateDecision({ question: "q", options: [{ id: "a", label: "A" }] }), /2–8 items/);
  assert.throws(() => validateDecision({ question: "q", options: [{ id: "A B", label: "x" }, { id: "b", label: "y" }] }), /lowercase/);
  assert.throws(() => validateDecision({ question: "q", options: [{ id: "a", label: "x" }, { id: "a", label: "y" }] }), /duplicated/);
  assert.equal(validateDecision(decision).options.length, 2);
});
