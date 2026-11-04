// Manual device command sender, for testing screens without the Agents API.
// Usage: node cmd.mjs <dev> state "JOB OPEN"
//        node cmd.mjs <dev> say "hello"
import "dotenv/config";
import mqtt from "mqtt";

const [dev, cmd, ...rest] = process.argv.slice(2);
if (!dev || !cmd) { console.error('usage: node cmd.mjs <tdeck-01|watcher-01> <state|say> "<text>"'); process.exit(1); }

const client = mqtt.connect(process.env.BROKER_URL, {
  username: process.env.BRIDGE_USER,
  password: process.env.BRIDGE_PASS,
});
client.on("connect", () => {
  const payload = cmd === "state" ? { cmd: "state", state: rest.join(" ") } : { cmd: "say", text: rest.join(" ") };
  client.publish(`monaid/${dev}/cmd`, JSON.stringify(payload), { qos: 1 }, () => {
    console.log("sent", JSON.stringify(payload), "to", dev);
    client.end();
  });
});
