// npm run api — start the Agents API (+ expiry watcher). Host/port from agents/config.json → api,
// overridable with MONAID_API_HOST / MONAID_API_PORT. Token: MONAID_API_TOKEN in agents/.env.
import { networkInterfaces } from "node:os";
import { config } from "../src/chain.js";
import { readEnv } from "../src/env.js";
import { warmFees } from "../src/fees.js";
import { createApi } from "../src/api.js";
import { MonaidService } from "../src/service.js";
import { killSwitch } from "../src/killswitch.js";
import { bus } from "../src/bus.js";

const apiCfg = (config as unknown as { api: { host: string; port: number } }).api;
const host = process.env.MONAID_API_HOST || apiCfg.host;
const port = Number(process.env.MONAID_API_PORT || apiCfg.port);

warmFees();
const service = new MonaidService();
const server = createApi(service, readEnv().MONAID_API_TOKEN ?? "");
service.startExpiryWatcher();

// one line per feed event on the console
bus.on("feed", (e) => {
  if (e.type === "tx") return;
  console.log(`[feed] ${e.type}${e.robot ? ` robot ${e.robot}` : ""} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !["time", "type", "robot"].includes(k))))}`);
});

server.listen(port, host, () => {
  console.log(`Monaid Agents API on http://${host}:${port}  (robots: ${[...service.agents.keys()].join(", ")})`);
  if (host === "0.0.0.0") {
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      for (const a of addrs ?? []) if (a.family === "IPv4" && !a.internal) console.log(`  reachable at http://${a.address}:${port}  (${name})`);
    }
  }
  console.log(`  kill switch: ${killSwitch().engaged ? "ENGAGED" : "off"} · expiry watcher on · token from agents/.env`);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    service.stopExpiryWatcher();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
