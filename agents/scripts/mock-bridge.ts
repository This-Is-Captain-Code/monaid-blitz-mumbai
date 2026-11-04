// npm run mock:bridge [-- happy|fail|all]
// Pretends to be the teammates' bridge (step/firmware-net: server/bridge/bridge.mjs) and drives the RUNNING Agents API
// exactly like it: POST /events {robotId: <number>, kind, seq, ts, data} with their kinds, seq 0 for broker up/down.
// It reads GET /feed with the bridge's own parsing rule (lines starting "data:", JSON.parse(line.slice(5)),
// act on m.robotId + m.screen) and checks every screen line we emit.
//   happy: crash on robot 2 (Watcher) → RAJ-7 typed on robot 1 (T-Deck) claims it → recover on robot 2 → PAID on both
//   fail:  crash on robot 2 → Watcher click claims (DEMO-1) → heartbeats only, no recover → expired after the window → BLOCKED
import { apiBase, config } from "../src/chain.js";
import { readEnv } from "../src/env.js";

const BASE = apiBase(); // MONAID_API_URL=https://… to run against the public deployment
const TOKEN = readEnv().MONAID_API_TOKEN ?? "";
const mode = process.argv.find((a) => ["happy", "fail", "all"].includes(a)) ?? "all";
const CLAIM_WINDOW = (config as unknown as { jobs: { claimWindowSec: number } }).jobs.claimWindowSec;
const R1 = 1; // tdeck-01, as the bridge maps it (DEV_TO_ROBOT)
const R2 = 2; // watcher-01
const ROBOT_TO_DEV: Record<number, string> = { 1: "tdeck-01", 2: "watcher-01" }; // the bridge's reverse map
const now = () => Math.floor(Date.now() / 1000);
const seqs: Record<number, number> = { 1: 40, 2: 70 };

async function call(method: string, path: string, body?: unknown, token = TOKEN) {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", "x-monaid-token": token }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
const statuses: { kind: string; status: number }[] = [];
async function ev(robotId: number, kind: string, data: Record<string, unknown> = {}, seq?: number) {
  const r = await call("POST", "/events", { robotId, kind, seq: seq ?? ++seqs[robotId], ts: now(), data });
  statuses.push({ kind, status: r.status });
  return r;
}
const lwt = (robotId: number, kind: "up" | "down") => ev(robotId, kind, { via: "lwt" }, 0);

const show = (label: string, r: { status: number; body: Record<string, any> }) => {
  const b = r.body;
  const extra = [b.action, b.jobId && `job ${b.jobId}`, b.worker && `worker ${b.worker}`, b.payout && `${b.payout} MON`, b.error, b.note ?? b.message].filter(Boolean).join(" · ");
  console.log(`→ ${label.padEnd(44)} ${r.status} ${extra}${b.tx?.link ? `\n${" ".repeat(50)}${b.tx.link}` : ""}`);
  return b;
};
const results: [string, boolean][] = [];
const check = (name: string, ok: unknown) => {
  results.push([name, !!ok]);
  if (!ok) console.log(`   ✖ ${name}`);
};

// ---- feed, parsed the way bridge.mjs parses it ----
const raw: string[] = []; // every data line, verbatim
const screens: { robotId: unknown; screen: any; at: number }[] = [];
const events: Record<string, any>[] = [];
let parserProblems = 0;
async function listenFeed() {
  const res = await fetch(`${BASE}/feed`, { headers: { "x-monaid-token": TOKEN } });
  if (!res.ok || !res.body) throw new Error(`feed http ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        raw.push(line);
        let m: any;
        try {
          m = JSON.parse(line.slice(5));
        } catch {
          parserProblems++;
          continue;
        }
        events.push(m);
        if (!m.screen) continue;
        // bridge: const dev = ROBOT_TO_DEV[robotId]; sendState if m.screen.state; sendSay if m.screen.say
        if (!ROBOT_TO_DEV[m.robotId as number]) parserProblems++;
        if (m.screen.state !== undefined && (typeof m.screen.state !== "string" || m.screen.state.length > 15)) parserProblems++;
        screens.push({ robotId: m.robotId, screen: m.screen, at: Date.now() });
        console.log(`   screen ▸ ${ROBOT_TO_DEV[m.robotId as number] ?? m.robotId}: ${JSON.stringify(m.screen)}`);
      }
    }
  })().catch(() => undefined);
  return reader;
}
const waitFor = async <T>(fn: () => T | undefined, ms: number) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
    const v = fn();
    if (v) return v;
  }
  return undefined;
};
const stateOnBoth = (state: string, since: number) =>
  waitFor(() => {
    const hits = [R1, R2].map((id) => screens.find((s) => s.robotId === id && s.screen.state === state && s.at >= since));
    return hits.every(Boolean) ? Math.max(...hits.map((h) => h!.at)) : undefined;
  }, 5000);

async function basics() {
  console.log("\n== basics (no gas) ==");
  check("401 wrong token", show("wrong token", await call("GET", "/robots", undefined, "x".repeat(32))).error === "UNAUTHORIZED");
  show("heartbeat robot 1", await ev(R1, "heartbeat", { up: 120, n: 12 }, 12));
  check("duplicate dropped with 200", show("same heartbeat again (QoS 1 duplicate)", await ev(R1, "heartbeat", { up: 120, n: 12 }, 12)).note?.startsWith("duplicate"));
  show("heartbeat robot 2", await ev(R2, "heartbeat", { up: 90, n: 9 }));
  show("knob robot 2", await ev(R2, "knob", { pos: 3 }));
  show("up (LWT) robot 1", await lwt(R1, "up"));
  show("power off robot 2", await ev(R2, "power", { on: false, charging: false }));
  show("recover robot 2 (no job)", await ev(R2, "recover", { sim: true }));
  show("click robot 2 (no job)", await ev(R2, "click"));
  const since = Date.now();
  show("claim typed 'MALLORY' on robot 1", await ev(R1, "claim", { text: "MALLORY" }));
  check("UNKNOWN WORKER on robot 1's screen", await waitFor(() => screens.find((s) => s.robotId === R1 && s.screen.say === "UNKNOWN WORKER" && s.at >= since), 3000));
}

async function happy() {
  console.log("\n== happy path: crash robot 2 → claim RAJ-7 on robot 1 → recover → PAID ==");
  let since = Date.now();
  const p = show("crash (Watcher long-press)", await ev(R2, "crash", { sim: true }));
  check("happy: job posted 0.01 MON", p.action === "job_posted" && p.payout === "0.01");
  check("happy: JOB OPEN on both screens", await stateOnBoth("JOB OPEN", since));
  check("happy: job card on screens", screens.some((s) => s.screen.cmd === "job" && s.screen.id === Number(p.jobId) && s.screen.payout === "0.01 MON"));
  show("down (LWT) robot 2 while job open", await lwt(R2, "down")); // must be ignored: the job already exists
  since = Date.now();
  const c = show("claim typed 'RAJ-7' on robot 1 (T-Deck)", await ev(R1, "claim", { text: "RAJ-7" }));
  check("happy: claim went to robot 2's job", c.action === "claim_accepted" && c.jobId === p.jobId);
  check("happy: CLAIMED on both screens", await stateOnBoth("CLAIMED", since));
  show("heartbeat robot 2 (not a proof for a crash)", await ev(R2, "heartbeat", { up: 95, n: 10 }));
  since = Date.now();
  const r = show("recover (Watcher release)", await ev(R2, "recover", { sim: true }));
  const paidAt = await stateOnBoth("PAID", since);
  check("happy: settled", r.action === "job_settled");
  check("happy: PAID on both screens", paidAt);
  check("happy: say line on paid", screens.some((s) => s.at >= since && typeof s.screen.say === "string" && s.screen.say.startsWith("paid")));
  if (paidAt) console.log(`✔ recover → PAID on both screens: ${paidAt - since} ms`);
  return paidAt ? paidAt - since : undefined;
}

async function fail() {
  console.log(`\n== fail path: crash robot 2 → claim → no recover → expire after ${CLAIM_WINDOW} s → BLOCKED ==`);
  let since = Date.now();
  const p = show("crash (Watcher long-press)", await ev(R2, "crash", { sim: true }));
  check("fail: job posted", p.action === "job_posted");
  check("fail: claim by Watcher click", show("click (worker confirm → DEMO-1)", await ev(R2, "click")).action === "claim_accepted");
  console.log(`   … heartbeats only, no recover. Waiting for job ${p.jobId} to expire`);
  since = Date.now();
  const hb = setInterval(() => void ev(R2, "heartbeat", { up: 200, n: ++seqs[R2] }).catch(() => undefined), 10_000);
  const blockedAt = await waitFor(() => screens.find((s) => s.robotId === R2 && s.screen.state === "BLOCKED" && s.at >= since)?.at, (CLAIM_WINDOW + 30) * 1000);
  clearInterval(hb);
  const ex = events.find((e) => e.type === "job_expired" && e.jobId === p.jobId);
  check("fail: expired", ex);
  check("fail: BLOCKED on both screens", blockedAt && (await stateOnBoth("BLOCKED", since)));
  if (ex) console.log(`✔ job ${p.jobId} expired ${Math.round((blockedAt! - since) / 1000)} s after the claim: ${ex.link}`);
}

const health = await fetch(BASE + "/health").then((r) => r.json()).catch(() => null);
if (!health?.ok) {
  console.error(`Agents API not reachable at ${BASE} — start it with: npm run api`);
  process.exit(1);
}
const reader = await listenFeed();
await basics();
let paidMs: number | undefined;
if (mode !== "fail") paidMs = await happy();
if (mode !== "happy") await fail();
await new Promise((r) => setTimeout(r, 500));
await reader.cancel();

const kinds = new Set(statuses.map((s) => s.kind));
const non200 = statuses.filter((s) => s.status !== 200);
check(`every event got 200 (${statuses.length} events)`, non200.length === 0);
check(`all 9 bridge kinds sent (${[...kinds].join(", ")})`, ["heartbeat", "down", "up", "crash", "recover", "click", "knob", "claim", "power"].every((k) => kinds.has(k)));
check("bridge parser accepts every screen line", parserProblems === 0 && screens.length > 0);
check('no "Muse" anywhere on the feed', !raw.some((l) => /muse/i.test(l)));
const forwarded = screens.filter((s) => s.screen.state || s.screen.say).length;
console.log(`\nfeed: ${raw.length} lines, ${screens.length} screen lines (${forwarded} forwarded by today's bridge; ${screens.length - forwarded} job cards need a cmd:"job" branch)`);
if (non200.length) console.log("non-200:", JSON.stringify(non200));
const failed = results.filter(([, ok]) => !ok);
console.log(`RESULT ${failed.length ? "FAIL" : "PASS"}: ${results.length - failed.length}/${results.length} checks${failed.length ? " — " + failed.map(([n]) => n).join("; ") : ""}${paidMs !== undefined ? ` · recover→PAID ${paidMs} ms` : ""}`);
if (failed.length) process.exitCode = 1;
