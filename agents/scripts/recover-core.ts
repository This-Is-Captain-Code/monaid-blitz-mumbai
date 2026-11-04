// npm run recover:core — before retiring the CURRENT MonaidCore (shared/addresses.json), return every robot's
// free balance to DEPLOYER via pay(). Raises maxPayout first if a balance is above the cap (owner = DEPLOYER).
// Escrow locked in open/claimed jobs is NOT recovered here — cancel or expire those jobs first.
import { formatEther, type Address } from "viem";
import { account } from "../src/env.js";
import { CORE_ABI, CORE_ADDRESS, config, publicClient, robotAddress } from "../src/chain.js";
import { describe, sendTx } from "../src/tx.js";

const read = <T>(functionName: string, args: readonly unknown[] = []) =>
  publicClient.readContract({ address: CORE_ADDRESS, abi: CORE_ABI, functionName, args }) as Promise<T>;
const deployer = account("DEPLOYER").address;

console.log(`Recovering robot balances from MonaidCore ${CORE_ADDRESS} → DEPLOYER ${deployer}\n`);
const robots = await Promise.all(
  config.robots.map(async (r) => {
    const addr = robotAddress(r.id);
    const [bal, escrow] = await Promise.all([read<bigint>("balanceOf", [addr]), read<bigint>("escrowOf", [addr])]);
    return { ...r, addr, bal, escrow };
  }),
);
for (const r of robots) if (r.escrow > 0n) console.log(`! robot ${r.id}: ${formatEther(r.escrow)} MON still in escrow — not recovered`);

const max = await read<bigint>("maxPayout");
const need = robots.reduce((m, r) => (r.bal > m ? r.bal : m), 0n);
let gas = 0n;
let recovered = 0n;
if (need > max) {
  const res = await sendTx({ wallet: "DEPLOYER", action: "setMaxPayout", reason: "retire core: allow full-balance recovery", to: CORE_ADDRESS, abi: CORE_ABI, functionName: "setMaxPayout", args: [need] });
  console.log(describe(res, `setMaxPayout ${formatEther(max)} → ${formatEther(need)} MON (old contract only)`));
  gas += res.fee;
}
for (const r of robots) {
  if (r.bal === 0n) {
    console.log(`• robot ${r.id}: 0 — skipped`);
    continue;
  }
  const res = await sendTx({
    wallet: r.agent,
    robot: r.id,
    action: "recoverCore",
    reason: `retire core: return robot ${r.id}'s balance to DEPLOYER`,
    to: CORE_ADDRESS,
    abi: CORE_ABI,
    functionName: "pay",
    args: [r.addr as Address, deployer, r.bal],
  });
  console.log(describe(res, `robot ${r.id}: ${formatEther(r.bal)} MON → DEPLOYER`));
  recovered += r.bal;
  gas += res.fee;
}
console.log(`\nRecovered ${formatEther(recovered)} MON for ${formatEther(gas)} MON gas.`);
