// Agents API: a small local HTTP service (node:http, no framework). The team boundary — see docs/agents-api.md.
// Every route except GET /health needs the X-Monaid-Token header (GET /feed also accepts ?token= because
// browser EventSource can't set headers).
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { BaseError } from "viem";
import { bus, type FeedEvent } from "./bus.js";
import { ApiError, MonaidService } from "./service.js";
import { PolicyBlockedError } from "./robot-agent.js";
import { KillSwitchError } from "./killswitch.js";
import { TxRevertedError } from "./tx.js";
import { FloorError } from "./funding.js";
import { UnknownWorkerError } from "./workers.js";

const MAX_BODY = 16 * 1024;

export function createApi(service: MonaidService, token: string) {
  if (!token || token.length < 16) throw new Error("MONAID_API_TOKEN missing or too short — run: npm run api:token");
  const want = Buffer.from(token);
  const authorized = (got: string | null | undefined) => {
    const b = Buffer.from(got ?? "");
    return b.length === want.length && timingSafeEqual(b, want);
  };

  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...cors });
    res.end(JSON.stringify(body));
  };

  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > MAX_BODY) throw new ApiError(413, "BAD_REQUEST", "body too large (max 16 KB)");
      chunks.push(c as Buffer);
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) return {};
    try {
      const v = JSON.parse(text);
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
      return v as Record<string, unknown>;
    } catch {
      throw new ApiError(400, "BAD_REQUEST", "body must be a JSON object");
    }
  }

  function errorBody(e: unknown): [number, Record<string, unknown>] {
    if (e instanceof ApiError) return [e.status, { ok: false, error: e.code, message: e.message }];
    if (e instanceof UnknownWorkerError) return [404, { ok: false, error: "UNKNOWN_WORKER", message: e.message }];
    if (e instanceof PolicyBlockedError) {
      return e.code === "KILL_SWITCH" ? [503, { ok: false, error: "KILL_SWITCH", message: e.message }] : [403, { ok: false, error: "BLOCKED", code: e.code, message: e.message }];
    }
    if (e instanceof KillSwitchError) return [503, { ok: false, error: "KILL_SWITCH", message: e.message }];
    if (e instanceof TxRevertedError) {
      return [422, { ok: false, error: "REVERTED", code: e.errorName, message: `MonaidCore: ${e.message} (${e.stage})`, link: e.hash ? `https://testnet.monadscan.com/tx/${e.hash}` : undefined }];
    }
    if (e instanceof FloorError) return [409, { ok: false, error: "REFUSED", message: e.message.split("\n")[0] }];
    const msg = e instanceof BaseError ? e.shortMessage : (e as Error)?.message ?? String(e);
    if (/^Invalid worker address|claimWindow must/.test(msg)) return [400, { ok: false, error: "BAD_REQUEST", message: msg }];
    console.error("internal error:", e);
    return [500, { ok: false, error: "INTERNAL", message: msg.split("\n")[0] }];
  }

  const clients = new Set<ServerResponse>();
  const onFeed = (ev: FeedEvent) => {
    const line = `data: ${JSON.stringify(ev)}\n\n`;
    for (const c of clients) c.write(line);
  };
  bus.on("feed", onFeed);
  const ping = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, 15_000);
  ping.unref();

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://local");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = req.method ?? "GET";
    try {
      if (method === "OPTIONS") {
        res.writeHead(204, cors);
        return res.end();
      }
      if (method === "GET" && path === "/health") return send(res, 200, { ok: true, service: "monaid-agents", version: 1 });

      const headerToken = req.headers["x-monaid-token"];
      const tok = Array.isArray(headerToken) ? headerToken[0] : headerToken;
      const viaQuery = path === "/feed" ? url.searchParams.get("token") : null;
      if (!authorized(tok) && !authorized(viaQuery)) throw new ApiError(401, "UNAUTHORIZED", "missing or wrong X-Monaid-Token");

      if (method === "GET" && path === "/feed") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive", ...cors });
        res.write(`data: ${JSON.stringify({ time: new Date().toISOString(), type: "hello" })}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (method === "GET" && path === "/robots") return send(res, 200, await service.robots());
      if (method === "GET" && path === "/jobs") return send(res, 200, { ok: true, jobs: service.jobs(url.searchParams.get("robotId") ?? undefined) });
      if (method === "GET" && path === "/approvals") return send(res, 200, service.approvals(url.searchParams.get("status") ?? undefined));
      if (method === "GET" && path === "/workers") return send(res, 200, service.workerList());

      if (method === "POST" && path === "/events") return send(res, 200, await service.handleEvent(await readJson(req)));
      const claim = path.match(/^\/jobs\/([^/]+)\/claim$/);
      if (method === "POST" && claim) return send(res, 200, await service.claimJob(decodeURIComponent(claim[1]), await readJson(req)));
      if (method === "POST" && path === "/owner/decide") return send(res, 200, await service.decide(await readJson(req)));
      if (method === "POST" && path === "/admin/kill") return send(res, 200, service.kill(await readJson(req)));
      if (method === "POST" && path === "/admin/reset-seq") return send(res, 200, service.resetSeq(await readJson(req)));

      throw new ApiError(404, "NOT_FOUND", `No route ${method} ${path}`);
    } catch (e) {
      const [status, body] = errorBody(e);
      if (!res.headersSent) send(res, status, body);
      else res.end();
    }
  });

  server.on("close", () => {
    bus.off("feed", onFeed);
    clearInterval(ping);
    for (const c of clients) c.end();
  });
  return server;
}

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-monaid-token",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
