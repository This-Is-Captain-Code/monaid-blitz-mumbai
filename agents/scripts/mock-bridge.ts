// npm run mock:bridge [-- happy|fail|all] [--approval]
// Pretends to be the teammates' MQTT bridge + portal and drives the RUNNING Agents API (npm run api) over HTTP,
// printing the /feed stream as it goes. Nothing here touches the bridge's real code.
//   happy (robot 1): crash → job posted → claim (worker demo-1) → power_on proof → worker paid
//          --approval: crash with level "urgent" (0.03 MON) → waits for the owner → POST /owner/decide → then as above
//          --muse:     like --approval, but Muse decides first (POST /muse/decide); on fallback the owner decides
//   fail  (robot 2): crash → job posted → claim event (demo-2) → no proof → claim window passes → expired, escrow back
// Also checks the rejections (no gas): wrong token, unknown robot, replayed seq, unknown worker.
import { config } from "../src/chain.js";
import { readEnv } from "../src/env.js";

const apiCfg = (config as unknown as { api: { host: string; port: number }; jobs: { claimWindowSec: number } }).api;
const host = process.env.MONAID_API_HOST || apiCfg.host;
const BASE = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${process.env.MONAID_API_PORT || apiCfg.port}`;
const TOKEN = readEnv().MONAID_API_TOKEN ?? "";
const mode = process.argv.find((a) => ["happy", "fail", "all"].includes(a)) ?? "all";
const withMuse = process.argv.includes("--muse");
const withApproval = process.argv.includes("--approval") || withMuse;
const CLAIM_WINDOW = (config as unknown as { jobs: { claimWindowSec: number } }).jobs.claimWindowSec;
const [R1, R2] = config.robots.map((r) => r.id);

let seqBase = Date.now(); // always above anything sent before
const nextSeq = () => ++seqBase;
const ts = () => Math.floor(Date.now() / 1000);

async function call(method: string, path: string, body?: unknown, token = TOKEN) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", "x-monaid-token": token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}
const show = (label: string, r: { status: number; body: Record<string, any> }) => {
  const b = r.body;
  const extra = [b.action, b.jobId && `job ${b.jobId}`, b.worker && `worker ${b.worker}`, b.payout && `${b.payout} MON`, b.approvalId && `approval ${b.approvalId}`, b.error, b.code, b.note ?? b.message]
    .filter(Boolean)
    .join(" · ");
  console.log(`→ ${label.padEnd(34)} ${r.status} ${extra}${b.tx?.link ? `\n${" ".repeat(40)}${b.tx.link}` : ""}`);
  return b;
};
const must = (cond: unknown, what: string) => {
  if (!cond) throw new Error(`mock-bridge: expected ${what}`);
};

// ---- feed listener ----
const feedLog: Record<string, any>[] = [];
async function listenFeed() {
  const res = await fetch(`${BASE}/feed?token=${encodeURIComponent(TOKEN)}`);
  must(res.ok && res.body, "GET /feed to open");
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const ev = JSON.parse(line.slice(6));
        feedLog.push(ev);
        if (ev.type === "tx" || ev.type === "hello") continue;
        const { time: _t, type, robot, ...rest } = ev;
        console.log(`   feed ▸ ${type}${robot ? ` (robot ${robot})` : ""} ${JSON.stringify(rest).slice(0, 160)}`);
      }
    }
  })().catch(() => undefined);
  return reader;
}
const waitFeed = async (pred: (e: Record<string, any>) => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const hit = feedLog.find(pred);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  return undefined;
};

// ---- flows ----
async function rejections() {
  console.log("\n== rejections (no gas) ==");
  must(show("wrong token", await call("GET", "/robots", undefined, "x".repeat(32))).error === "UNAUTHORIZED", "401");
  must(show("unknown robot", await call("POST", "/events", { robotId: "nope", kind: "crash", seq: nextSeq(), ts: ts() })).error === "UNKNOWN_ROBOT", "404 robot");
  const s = nextSeq();
  show("knob event (no core action)", await call("POST", "/events", { robotId: R1, kind: "knob", seq: s, ts: ts(), data: { value: 3 } }));
  must(show("same seq again (replay)", await call("POST", "/events", { robotId: R1, kind: "knob", seq: s, ts: ts() })).error === "STALE_SEQ", "409 replay");
  must(show("bad kind", await call("POST", "/events", { robotId: R1, kind: "explode", seq: nextSeq(), ts: ts() })).error === "BAD_REQUEST", "400");
}

async function happy() {
  console.log(`\n== happy path, robot ${R1}${withApproval ? " (approval beat, urgent 0.03 MON)" : ""} ==`);
  const ev = show("crash", await call("POST", "/events", { robotId: R1, kind: "crash", seq: nextSeq(), ts: ts(), data: withApproval ? { level: "urgent" } : {} }));
  let jobId: string = ev.jobId;
  if (ev.action === "pending_approval") {
    show("GET /approvals?status=pending", await call("GET", "/approvals?status=pending"));
    if (withMuse) {
      // WhatsApp transport stand-in: the owner forwarded the link to Muse
      const m = await call("POST", "/muse/decide", { approvalId: ev.approvalId });
      const muse = m.body.muse ?? {};
      console.log(
        `→ ${"muse decides".padEnd(34)} ${m.status} ${muse.source}${muse.choice ? ` · ${muse.choice}` : ""} · ${muse.reason ?? `${muse.fallback}: ${muse.detail}`}` +
          (m.body.applied?.tx?.link ? `\n${" ".repeat(40)}${m.body.applied.tx.link}` : ""),
      );
      if (muse.source === "muse" && muse.choice === "approve" && m.body.applied?.ok) jobId = m.body.applied.jobId;
      else if (muse.source === "muse" && muse.choice === "reject") {
        console.log("   Muse rejected the urgent job — happy path ends here (owner can still post another).");
        return undefined;
      }
    }
    if (!jobId) {
      const d = show("owner decides: approve", await call("POST", "/owner/decide", { approvalId: ev.approvalId, decision: "approve" }));
      jobId = d.jobId;
    }
  }
  must(jobId, "a posted job");
  must(show("claim unknown worker", await call("POST", `/jobs/${jobId}/claim`, { worker: "mallory" })).error === "UNKNOWN_WORKER", "404 worker");
  must(show("claim (portal) demo-1", await call("POST", `/jobs/${jobId}/claim`, { worker: "demo-1" })).ok, "claim ok");
  const p = show("power_on (proof)", await call("POST", "/events", { robotId: R1, kind: "power_on", seq: nextSeq(), ts: ts() }));
  must(p.action === "job_settled", "job_settled");
  return jobId;
}

async function fail() {
  console.log(`\n== fail path, robot ${R2} (claim window ${CLAIM_WINDOW} s) ==`);
  const ev = show("crash", await call("POST", "/events", { robotId: R2, kind: "crash", seq: nextSeq(), ts: ts() }));
  must(ev.action === "job_posted", "job_posted");
  must(show("claim event demo-2", await call("POST", "/events", { robotId: R2, kind: "claim", seq: nextSeq(), ts: ts(), data: { worker: "demo-2" } })).action === "claim_accepted", "claim_accepted");
  show("power_off (not a proof)", await call("POST", "/events", { robotId: R2, kind: "power_off", seq: nextSeq(), ts: ts() }));
  console.log(`   … no fix. Waiting for the claim window to pass and the agent to expire job ${ev.jobId}`);
  const ex = await waitFeed((e) => e.type === "job_expired" && e.jobId === ev.jobId, (CLAIM_WINDOW + 30) * 1000);
  must(ex, "job_expired on the feed");
  console.log(`✔ job ${ev.jobId} expired, escrow back to robot ${R2}: ${ex!.link}`);
  return ev.jobId as string;
}

const health = await fetch(BASE + "/health").then((r) => r.json()).catch(() => null);
if (!health?.ok) {
  console.error(`Agents API not reachable at ${BASE} — start it with: npm run api`);
  process.exit(1);
}
const reader = await listenFeed();
await rejections();
if (mode !== "fail") await happy();
if (mode !== "happy") await fail();
show("GET /robots", await call("GET", "/robots"));
const jobs = (await call("GET", "/jobs")).body.jobs as { jobId: string; robotId: string; status: string; payout: string; worker?: string }[];
console.log("\nlatest jobs:", jobs.slice(0, 4).map((j) => `#${j.jobId} r${j.robotId} ${j.status} ${j.payout} MON ${j.worker ?? ""}`).join(" | "));
// The mock uses millisecond timestamps as seq; reset so real devices can count from 0 again.
show("POST /admin/reset-seq", await call("POST", "/admin/reset-seq", {}));
await reader.cancel();
console.log("\nmock bridge: done ✔");
