// Demo driver: the understudy agent. Stages all three acts on real hardware
// without the Agents API. Real device events in, screen choreography out.
//
// Triggers:  keys  w=wake arc note, c=charger, h=bring-me-home, b=beacons, r=reset, q=quit
//            topic monaid/demo/ctl  {"go":"charger"|"home"|"reset"}
// Wake Me Up runs itself: crash/death of watcher-01 starts it, recovery settles it.
import "dotenv/config";
import mqtt from "mqtt";
import readline from "node:readline";

const TDECK = "tdeck-01", WATCHER = "watcher-01";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const c = mqtt.connect(process.env.BROKER_URL, {
  username: process.env.BRIDGE_USER, password: process.env.BRIDGE_PASS,
  clientId: "demo-" + Math.random().toString(16).slice(2, 8),
});

const cmd = (dev, o) => c.publish(`monaid/${dev}/cmd`, JSON.stringify(o), { qos: 1 });
const state = (dev, s) => cmd(dev, { cmd: "state", state: s });
const job = (dev, id, payout, worker = "") => cmd(dev, { cmd: "job", id, payout, worker });
const jobClear = (dev) => cmd(dev, { cmd: "job", id: "" });
const say = (dev, text) => cmd(dev, { cmd: "say", text });
const sim = (dev, kind) => cmd(dev, { cmd: "simulate", kind });

let arc = "idle"; // idle | wake | charger | home
let jobId = 100;
let bounty = 0, bountyTimer = null, beacons = new Set();
let pending = [];
const later = (fn, ms) => pending.push(setTimeout(fn, ms));
const cancelPending = () => { for (const t of pending) clearTimeout(t); pending = []; };

function reset() {
  arc = "idle";
  cancelPending();
  clearInterval(bountyTimer); bountyTimer = null; beacons.clear();
  for (const d of [TDECK, WATCHER]) { jobClear(d); say(d, ""); state(d, "IDLE"); }
  log("reset -> IDLE");
}

// ---- Act 1: Wake Me Up (auto on crash/death of watcher) ----
function wakeStart(reason) {
  if (arc === "wake") return;
  arc = "wake"; jobId++;
  log(`WAKE: watcher ${reason} -> posting revival job #${jobId}`);
  later(() => { job(TDECK, jobId, "0.25 MON"); state(TDECK, "JOB OPEN"); say(TDECK, "peer down: revive it"); }, 1200);
  later(() => { job(TDECK, jobId, "0.25 MON", "RAJ-7"); state(TDECK, "CLAIMED"); say(TDECK, "Claude picked RAJ-7"); }, 4500);
}
function wakeSettle(reason) {
  if (arc !== "wake") return;
  cancelPending();
  log(`WAKE: watcher ${reason} -> settle, PAID`);
  job(WATCHER, jobId, "0.25 MON", "RAJ-7"); state(WATCHER, "PAID"); say(WATCHER, "revival proven");
  state(TDECK, "IDLE"); jobClear(TDECK); say(TDECK, "");
  arc = "idle";
  setTimeout(() => { if (arc === "idle") reset(); }, 8000);
}

// ---- Act 2: Charger ----
function chargerStart() {
  arc = "charger"; jobId++;
  log(`CHARGER: auction open, job #${jobId}`);
  state(TDECK, "BIDDING"); say(TDECK, "bid: 0.18 MON");
  state(WATCHER, "BIDDING"); say(WATCHER, "bid: 0.25 MON");
  later(() => {
    if (arc !== "charger") return;
    log("CHARGER: watcher wins, tdeck paid to yield, cable job posted");
    state(TDECK, "PAID"); say(TDECK, "paid to yield: 0.07 MON");
    job(WATCHER, jobId, "0.20 MON"); state(WATCHER, "JOB OPEN"); say(WATCHER, "swap my cable");
  }, 4000);
}
function chargerSettle() {
  if (arc !== "charger") return;
  log("CHARGER: power arrived -> settle, PAID");
  state(WATCHER, "PAID"); say(WATCHER, "wire went live");
  setTimeout(() => { if (arc === "charger") reset(); }, 8000);
}

// ---- Act 3: Bring Me Home ----
function homeStart() {
  arc = "home"; jobId++; bounty = 0.5; beacons.clear();
  log(`HOME: tdeck lost, bounty rising, job #${jobId}`);
  state(TDECK, "LOST"); job(TDECK, jobId, bounty.toFixed(2) + " MON"); say(TDECK, "bring me to desk 12");
  say(WATCHER, "home base: waiting");
  bountyTimer = setInterval(() => {
    bounty += 0.01;
    job(TDECK, jobId, bounty.toFixed(2) + " MON");
  }, 2000);
}
function homeClaim(text) {
  if (arc !== "home") return;
  clearInterval(bountyTimer); bountyTimer = null;
  log(`HOME: claimed by ${text} at ${bounty.toFixed(2)} MON`);
  state(TDECK, "CLAIMED"); job(TDECK, jobId, bounty.toFixed(2) + " MON", text);
}
function homeBeacon(dev) {
  if (arc !== "home") return;
  beacons.add(dev);
  log(`HOME: beacon from ${dev} (${beacons.size}/2)`);
  if (beacons.size === 2) {
    log("HOME: reunited -> settle, PAID");
    for (const d of [TDECK, WATCHER]) { state(d, "PAID"); }
    say(TDECK, "home. finder paid " + bounty.toFixed(2));
    setTimeout(() => { if (arc === "home") reset(); }, 8000);
  }
}

// ---- Event handling ----
c.on("connect", () => {
  log("demo driver connected");
  c.subscribe(["monaid/+/evt", "monaid/+/status", "monaid/demo/ctl"], { qos: 1 });
  log("keys: c=charger  h=home  b=beacons(sim)  r=reset  q=quit  (wake arc = crash the watcher)");
});

c.on("message", (t, p) => {
  if (t === "monaid/demo/ctl") {
    try { const m = JSON.parse(p); if (m.go === "charger") chargerStart(); else if (m.go === "home") homeStart(); else if (m.go === "reset") reset(); } catch {}
    return;
  }
  const [, dev, leaf] = t.split("/");
  if (leaf === "status") {
    const online = p.toString() === "online";
    log(`status ${dev}: ${p}`);
    if (dev === WATCHER && !online) wakeStart("died (last will)");
    if (dev === WATCHER && online && arc === "wake") setTimeout(() => wakeSettle("back online"), 1500);
    return;
  }
  let e; try { e = JSON.parse(p.toString()); } catch { return; }
  if (e.kind === "heartbeat") return;
  log(`event ${dev}/${e.kind}`, JSON.stringify(e.data ?? {}));
  if (dev === WATCHER && e.kind === "crash") wakeStart("crashed");
  if (dev === WATCHER && e.kind === "recover") wakeSettle("recovered");
  if (dev === WATCHER && e.kind === "power" && (e.data?.on === true || e.data?.sim)) chargerSettle();
  if (dev === TDECK && e.kind === "claim") homeClaim(e.data?.text ?? "finder");
  if (e.kind === "beacon") homeBeacon(dev);
});

// ---- Keyboard ----
if (process.stdin.isTTY) {
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.on("keypress", (_s, k) => {
    if (!k) return;
    if (k.name === "q" || (k.ctrl && k.name === "c")) { reset(); setTimeout(() => process.exit(0), 500); }
    else if (k.name === "c") chargerStart();
    else if (k.name === "h") homeStart();
    else if (k.name === "b") { sim(TDECK, "beacon"); sim(WATCHER, "beacon"); }
    else if (k.name === "r") reset();
  });
}
