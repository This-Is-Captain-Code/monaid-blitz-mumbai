// npm run wallets — every wallet in agents/.env with balance, floor, spendable, and robots in MonaidCore.
import { formatEther, zeroAddress, type Address } from "viem";
import { account, walletNames } from "../src/env.js";
import { CORE_ABI, CORE_ADDRESS, addressLink, config, floorOf, publicClient, roleOf, robotAddress } from "../src/chain.js";

const fmt = (wei: bigint) => Number(formatEther(wei)).toFixed(4);

const rows = await Promise.all(
  walletNames().map(async (name) => {
    const address = account(name).address;
    const balance = await publicClient.getBalance({ address });
    const floor = floorOf(name);
    const spendable = balance > floor ? balance - floor : 0n;
    return { name, address, role: roleOf(name), balance, floor, spendable, low: balance < floor };
  }),
);

console.log(`Wallets (agents/.env) — ${config.network.name}\n`);
console.table(
  rows.map((r) => ({
    name: r.name,
    address: r.address,
    role: r.role,
    "balance MON": fmt(r.balance),
    "floor MON": fmt(r.floor),
    "spendable MON": fmt(r.spendable),
    "": r.low ? "BELOW FLOOR" : "",
  })),
);
for (const r of rows) console.log(`${r.name.padEnd(10)} ${addressLink(r.address)}`);

console.log(`\nRobots in MonaidCore ${CORE_ADDRESS}\n`);
const robots = await Promise.all(
  config.robots.map(async (r) => {
    const addr = robotAddress(r.id);
    const read = (functionName: string) =>
      publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName, args: [addr] }) as Promise<unknown>;
    const [agentOf, bal] = await Promise.all([read("agentOf") as Promise<Address>, read("balanceOf") as Promise<bigint>]);
    let expected = "";
    try {
      expected = account(r.agent).address;
    } catch {
      expected = "(no wallet)";
    }
    const status =
      agentOf === zeroAddress ? "not registered" : agentOf.toLowerCase() === expected.toLowerCase() ? "registered" : `MISMATCH (${agentOf})`;
    return { robot: r.id, "robot address": addr, agent: r.agent, status, "balance in core MON": fmt(bal) };
  }),
);
console.table(robots);
