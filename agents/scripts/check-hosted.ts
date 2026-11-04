// npm run check:hosted — starts the API the way Render runs it (no agents/.env file, secrets only in the process
// environment, no DEPLOYER key, PORT set) and checks /health, token auth, /robots and the SSE headers.
// agents/.env is renamed for the duration of the check and always restored. No key or token is printed.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";
import { AGENTS_DIR } from "../src/env.js";

const ENV = join(AGENTS_DIR, ".env");
const BAK = join(AGENTS_DIR, ".env.hosted-check");
const PORT = 4100;
const file = parse(readFileSync(ENV, "utf8"));
const hostedEnv: Record<string, string> = {};
for (const k of ["AGENT_1_PRIVATE_KEY", "AGENT_2_PRIVATE_KEY", "MONAID_API_TOKEN", "OPENROUTER_API_KEY"]) if (file[k]) hostedEnv[k] = file[k];
const token = hostedEnv.MONAID_API_TOKEN ?? "";

let failed = 0;
const ok = (good: boolean, label: string, detail = "") => {
  if (!good) failed++;
  console.log(`${good ? "✔" : "✖"} ${label.padEnd(36)} ${detail}`);
};

renameSync(ENV, BAK);
const child = spawn(process.execPath, ["--import", "tsx", "scripts/api.ts"], {
  cwd: AGENTS_DIR,
  env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", PORT: String(PORT), ...hostedEnv },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
try {
  const base = `http://127.0.0.1:${PORT}`;
  let health: { ok?: boolean } | null = null;
  for (let i = 0; i < 60 && !health; i++) {
    health = await fetch(`${base}/health`).then((r) => r.json()).catch(() => null);
    if (!health) await new Promise((r) => setTimeout(r, 250));
  }
  ok(!!health?.ok, "starts with env-only secrets, PORT", `listening on 0.0.0.0:${PORT}: ${/0\.0\.0\.0/.test(log)}`);
  ok(!existsSync(ENV), "no agents/.env present during check");
  ok((await fetch(`${base}/robots`)).status === 401, "no token → 401");
  const robots = await fetch(`${base}/robots`, { headers: { "x-monaid-token": token } }).then((r) => r.json());
  ok(robots.ok && robots.robots?.length === 2, "token → /robots (agents work without DEPLOYER key)", robots.robots?.map((r: { robotId: string; agentBalance: string }) => `${r.robotId} ${Number(r.agentBalance).toFixed(3)} MON`).join(", "));
  const ac = new AbortController();
  const sse = await fetch(`${base}/feed`, { headers: { "x-monaid-token": token }, signal: ac.signal });
  const first = await sse.body!.getReader().read();
  ok(sse.headers.get("content-type") === "text/event-stream" && sse.headers.get("x-accel-buffering") === "no", "SSE headers (no buffering)", `${sse.headers.get("cache-control")}`);
  ok(new TextDecoder().decode(first.value).includes('"type":"hello"'), "SSE first event arrives immediately");
  ac.abort();
  const pre = await fetch(`${base}/robots`, { method: "OPTIONS", headers: { origin: "https://portal.example" } });
  ok(pre.status === 204 && !!pre.headers.get("access-control-allow-origin"), "CORS preflight", `allow-origin ${pre.headers.get("access-control-allow-origin")}`);
} finally {
  child.kill();
  renameSync(BAK, ENV);
  console.log(existsSync(ENV) ? "agents/.env restored" : "!! agents/.env NOT restored — rename agents/.env.hosted-check back");
}
console.log(failed ? `✖ ${failed} hosted check(s) failed` : "✔ hosted mode OK");
if (failed) process.exitCode = 1;
