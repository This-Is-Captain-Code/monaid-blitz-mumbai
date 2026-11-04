// Monaid bridge: EMQX (devices) <-> Agents API (agents).
// Devices publish events on monaid/<dev>/evt and status on monaid/<dev>/status (LWT).
// The bridge forwards them to POST /events as {robotId, kind, seq, ts, data}.
// With FEED_ENABLED=1 it also listens to GET /feed (SSE) and drives device screens.
import "dotenv/config";
import mqtt from "mqtt";

const BROKER_URL = process.env.BROKER_URL;
const AGENTS_API = process.env.AGENTS_API || "";
const TOKEN = process.env.MONAID_TOKEN || "";
const FEED_ENABLED = process.env.FEED_ENABLED === "1";

// Device <-> robot mapping (see shared/addresses.json)
const DEV_TO_ROBOT = { "tdeck-01": 1, "watcher-01": 2 };
const ROBOT_TO_DEV = Object.fromEntries(Object.entries(DEV_TO_ROBOT).map(([d, r]) => [r, d]));

const log = (...a) => console.log(new Date().toISOString(), ...a);

const client = mqtt.connect(BROKER_URL, {
  username: process.env.BRIDGE_USER,
  password: process.env.BRIDGE_PASS,
  clientId: "bridge-" + Math.random().toString(16).slice(2, 8),
  clean: true,
});

client.on("connect", () => {
  log("mqtt connected", BROKER_URL);
  client.subscribe(["monaid/+/evt", "monaid/+/status"], { qos: 1 });
});
client.on("error", (e) => log("mqtt error:", e.message));

async function postEvent(ev) {
  if (!AGENTS_API) { log("event (log-only):", JSON.stringify(ev)); return; }
  try {
    const res = await fetch(`${AGENTS_API}/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-monaid-token": TOKEN },
      body: JSON.stringify(ev),
    });
    log(`-> POST /events ${ev.kind} robot=${ev.robotId}: ${res.status}`);
  } catch (e) {
    log(`-> POST /events failed (${e.message}); event:`, JSON.stringify(ev));
  }
}

client.on("message", (topic, payload) => {
  const [, dev, leaf] = topic.split("/");
  const robotId = DEV_TO_ROBOT[dev];
  if (!robotId) { log("unknown device:", dev); return; }

  if (leaf === "status") {
    const online = payload.toString() === "online";
    // The LWT 'offline' is the death beat: the broker saw the device vanish.
    postEvent({ robotId, kind: online ? "up" : "down", seq: 0, ts: Math.floor(Date.now() / 1000), data: { via: "lwt" } });
    return;
  }

  try {
    const e = JSON.parse(payload.toString());
    postEvent({ robotId, kind: e.kind, seq: e.seq, ts: e.ts, data: e.data ?? {} });
  } catch {
    log("bad event payload on", topic, payload.toString().slice(0, 120));
  }
});

// ---- Screens: send a command to a device ----
// state: one of IDLE | BIDDING | JOB OPEN | CLAIMED | PAID | BLOCKED (free text <=15 chars)
export function sendState(robotId, state) {
  const dev = ROBOT_TO_DEV[robotId];
  if (dev) client.publish(`monaid/${dev}/cmd`, JSON.stringify({ cmd: "state", state }), { qos: 1 });
}
export function sendSay(robotId, text) {
  const dev = ROBOT_TO_DEV[robotId];
  if (dev) client.publish(`monaid/${dev}/cmd`, JSON.stringify({ cmd: "say", text }), { qos: 1 });
}

// ---- Feed: agents -> screens (enable once GET /feed exists) ----
// Expected SSE data lines: {"robotId":1,"screen":{"state":"JOB OPEN"}} or {"robotId":1,"screen":{"say":"..."}}
async function followFeed() {
  while (true) {
    try {
      const res = await fetch(`${AGENTS_API}/feed`, { headers: { "x-monaid-token": TOKEN } });
      if (!res.ok || !res.body) throw new Error(`feed http ${res.status}`);
      log("feed connected");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (!line.startsWith("data:")) continue;
          try {
            const m = JSON.parse(line.slice(5));
            if (m.screen?.state) sendState(m.robotId, m.screen.state);
            if (m.screen?.say) sendSay(m.robotId, m.screen.say);
          } catch { /* ignore non-JSON data lines */ }
        }
      }
      throw new Error("feed ended");
    } catch (e) {
      log("feed:", e.message, "- retrying in 3s");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

if (FEED_ENABLED && AGENTS_API) followFeed();
log(`bridge up. api=${AGENTS_API || "(log-only)"} feed=${FEED_ENABLED}`);
