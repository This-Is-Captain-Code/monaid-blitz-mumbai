// npm run preflight — go/no-go before the demo. Exits 1 if anything blocking fails.
import { formatEther, parseEther, type Address } from "viem";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AGENTS_DIR, account, readEnv } from "../src/env.js";
import { CORE_ABI, CORE_ADDRESS, FLOORS, config, publicClient, robotConfig } from "../src/chain.js";
import { workers } from "../src/workers.js";

let failed = 0;
const ok = (good: boolean, label: string, detail = "", warnOnly = false) => {
  if (!good && !warnOnly) failed++;
  console.log(`${good ? "✔" : warnOnly ? "⚠" : "✖"} ${label.padEnd(30)} ${detail}`);
};
const read = <T>(functionName: string, args: readonly unknown[] = []) =>
  publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName, args }) as Promise<T>;

// chain
try {
  const t0 = Date.now();
  const [chainId, block] = await Promise.all([publicClient.getChainId(), publicClient.getBlockNumber()]);
  ok(chainId === 10143, "RPC reachable", `chain ${chainId}, block ${block}, ${Date.now() - t0} ms`);
} catch (e) {
  ok(false, "RPC reachable", (e as Error).message.split("\n")[0]);
}
try {
  const [owner, paused, max] = await Promise.all([read<Address>("owner"), read<boolean>("paused"), read<bigint>("maxPayout")]);
  ok(owner.toLowerCase() === account("DEPLOYER").address.toLowerCase(), "MonaidCore owner = DEPLOYER", CORE_ADDRESS);
  ok(!paused, "MonaidCore not paused");
  ok(max >= parseEther("0.03"), "maxPayout covers demo payouts", `${formatEther(max)} MON`);
} catch (e) {
  ok(false, "MonaidCore readable", (e as Error).message.split("\n")[0]);
}

try {
  const deployed = JSON.parse(readFileSync(join(AGENTS_DIR, "..", "contracts", "ignition", "deployments", "chain-10143", "deployed_addresses.json"), "utf8"));
  const latest = deployed["MonaidCoreV1_1Module#MonaidCore"] as string | undefined;
  const code = await publicClient.getCode({ address: CORE_ADDRESS });
  const match = !!latest && latest.toLowerCase() === CORE_ADDRESS.toLowerCase() && !!code && code !== "0x";
  ok(match, "contract matches shared/", `shared/addresses.json = Ignition v1.1 = ${CORE_ADDRESS}, code ${code ? (code.length - 2) / 2 : 0} bytes`);
} catch (e) {
  ok(false, "contract matches shared/", (e as Error).message.split("\n")[0]);
}

// wallets + robots
const dep = await publicClient.getBalance({ address: account("DEPLOYER").address });
ok(dep >= FLOORS.deployer + parseEther("1"), "DEPLOYER above floor (+1)", `${formatEther(dep)} MON (floor ${formatEther(FLOORS.deployer)})`);
for (const r of config.robots) {
  const rc = robotConfig(r.id);
  const ag = account(r.agent).address;
  const [bal, agentOf, robotBal] = await Promise.all([publicClient.getBalance({ address: ag }), read<Address>("agentOf", [rc.address]), read<bigint>("balanceOf", [rc.address])]);
  ok(bal >= FLOORS.agentGas, `${r.agent} gas above floor`, `${formatEther(bal)} MON`);
  ok(agentOf.toLowerCase() === ag.toLowerCase(), `robot ${r.id} registered`, `→ ${r.agent} (bridge robotId ${r.bridgeId ?? "-"})`);
  ok(robotBal >= parseEther("0.03"), `robot ${r.id} funded`, `${formatEther(robotBal)} MON in MonaidCore`);
}
ok(workers().size > 0, "worker registry loaded", [...workers().keys()].join(", "));

// API
const env = readEnv();
ok(!!env.MONAID_API_TOKEN, "MONAID_API_TOKEN set", "(agents/.env)");
const apiCfg = (config as unknown as { api: { host: string; port: number } }).api;
const BASE = `http://${apiCfg.host === "0.0.0.0" ? "127.0.0.1" : apiCfg.host}:${apiCfg.port}`;
const health = await fetch(`${BASE}/health`).then((r) => r.json()).catch(() => null);
ok(!!health?.ok && apiCfg.port === 4000, "API up on port 4000", `${BASE} (bridge: AGENTS_API=http://<this laptop>:${apiCfg.port})`);
if (health?.ok) {
  const robots = await fetch(`${BASE}/robots`, { headers: { "x-monaid-token": env.MONAID_API_TOKEN ?? "" } }).then((r) => r.json()).catch(() => null);
  ok(!!robots?.ok, "API token accepted");
  ok(robots?.killSwitch?.engaged === false, "kill switch off", robots?.killSwitch?.engaged ? `ENGAGED: ${robots.killSwitch.reason}` : "");
}
ok(!!(env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY), "OpenRouter key (decisions)", "missing → owner decides", true);

console.log(failed ? `\n✖ ${failed} check(s) failed — not ready` : "\n✔ preflight passed — ready to demo");
if (failed) process.exitCode = 1;
