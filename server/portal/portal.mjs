// Monaid portal: phone-sized page for jobs, claims, and owner decisions.
// Proxies the Agents API (token stays here) and relays its SSE feed.
// Without AGENTS_API it runs in mock mode so the UI is testable offline.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// tiny .env loader (no deps)
const envPath = join(dirname(fileURLToPath(import.meta.url)), ".env");
if (existsSync(envPath)) for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const PORT = Number(process.env.PORTAL_PORT || 3000);
const API = process.env.AGENTS_API || "";
const TOKEN = process.env.MONAID_TOKEN || "";
const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "index.html"));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// mock data for offline UI work
const mock = {
  robots: { ok: true, robots: [
    { robotId: "tdeck-01", balance: "0.5", agentBalance: "3.2", openJobs: 0 },
    { robotId: "watcher-01", balance: "0.49", agentBalance: "2.1", openJobs: 1 },
  ]},
  jobs: { ok: true, jobs: [
    { jobId: "19", robotId: "watcher-01", status: "open", payout: "0.01", postedAt: Date.now() / 1000 },
  ]},
  approvals: { ok: true, approvals: [] },
  workers: { ok: true, workers: [{ id: "demo-1" }, { id: "demo-2" }, { id: "raj-7" }] },
};

async function proxy(req, res, method, path, body) {
  if (!API) { // mock mode
    const key = path.replace("/", "").split("?")[0];
    if (method === "POST") return send(res, 200, { ok: true, mock: true, path });
    return send(res, 200, mock[key] ?? { ok: true, mock: true });
  }
  try {
    const r = await fetch(API + path, {
      method,
      headers: { "x-monaid-token": TOKEN, "content-type": "application/json" },
      body: body || undefined,
    });
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(await r.text());
  } catch (e) {
    send(res, 502, { ok: false, error: "AGENTS_API_UNREACHABLE", message: e.message });
  }
}

function send(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function relayFeed(res) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  if (!API) { res.write(`data: {"type":"mock","note":"no AGENTS_API configured"}\n\n`); return; }
  try {
    const r = await fetch(API + "/feed", { headers: { "x-monaid-token": TOKEN } });
    if (!r.ok || !r.body) throw new Error(`feed ${r.status}`);
    const reader = r.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } catch (e) {
    res.write(`data: {"type":"feed_error","message":${JSON.stringify(e.message)}}\n\n`);
  }
  res.end();
}

const routes = [
  ["GET", /^\/api\/(jobs|robots|approvals|workers)(\?.*)?$/, (req, res, m) => proxy(req, res, "GET", "/" + m[1] + (m[2] || ""))],
  ["POST", /^\/api\/jobs\/([^/]+)\/claim$/, (req, res, m, body) => proxy(req, res, "POST", `/jobs/${m[1]}/claim`, body)],
  ["POST", /^\/api\/owner\/decide$/, (req, res, _m, body) => proxy(req, res, "POST", "/owner/decide", body)],
  ["POST", /^\/api\/agent\/decide$/, (req, res, _m, body) => proxy(req, res, "POST", "/agent/decide", body)],
];

http.createServer((req, res) => {
  const url = req.url || "/";
  if (req.method === "GET" && (url === "/" || url === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(page);
  }
  if (req.method === "GET" && url === "/api/feed") return relayFeed(res);
  for (const [method, re, fn] of routes) {
    const m = url.match(re);
    if (m && req.method === method) {
      let body = "";
      req.on("data", (d) => (body += d));
      req.on("end", () => fn(req, res, m, body));
      return;
    }
  }
  send(res, 404, { ok: false, error: "NOT_FOUND" });
}).listen(PORT, "0.0.0.0", () => log(`portal on http://0.0.0.0:${PORT} api=${API || "(mock)"}`));
