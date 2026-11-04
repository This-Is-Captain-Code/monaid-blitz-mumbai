// Round-trip self-test: send simulate commands, verify the events echo back.
import "dotenv/config";
import mqtt from "mqtt";

const c = mqtt.connect(process.env.BROKER_URL, {
  username: process.env.BRIDGE_USER, password: process.env.BRIDGE_PASS,
});
const seen = [];
const want = ["tdeck-01/claim", "watcher-01/power"];

c.on("connect", () => {
  console.log("connected; sending simulates");
  c.subscribe(["monaid/+/evt", "monaid/+/status"], { qos: 1 }, () => {
    c.publish("monaid/tdeck-01/cmd", JSON.stringify({ cmd: "simulate", kind: "claim" }), { qos: 1 });
    c.publish("monaid/watcher-01/cmd", JSON.stringify({ cmd: "simulate", kind: "power" }), { qos: 1 });
  });
});
c.on("message", (t, p) => {
  const dev = t.split("/")[1];
  if (t.endsWith("/status")) { console.log(`status ${dev}: ${p}`); return; }
  const e = JSON.parse(p);
  if (e.kind !== "heartbeat") {
    console.log(`event ${dev}/${e.kind}: ${p}`);
    seen.push(`${dev}/${e.kind}`);
  }
});
setTimeout(() => {
  for (const w of want) console.log(seen.includes(w) ? `PASS ${w}` : `MISS ${w}`);
  c.end(); process.exit(0);
}, 12000);
