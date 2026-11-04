// One-off (P4): pull robot balances out of the retired MonaidCore v0 back to DEPLOYER, using v0's own pay().
// Each robot's agent pays its full v0 balance to DEPLOYER. Safe to re-run (skips empty balances).
//   npm run recover:v0
import { formatEther, getAddress, keccak256, parseAbi, slice, toHex, type Address } from "viem";
import { account } from "../src/env.js";
import { publicClient, robotAddress } from "../src/chain.js";
import { describe, sendTx } from "../src/tx.js";

const V0 = getAddress("0xDD22ee7923195EbBcC247d40553BCB138A6D5BBf");
const V0_ABI = parseAbi([
  "function pay(address robot, address to, uint256 amount)",
  "function balanceOf(address robot) view returns (uint256)",
  "function agentOf(address robot) view returns (address)",
  "error NotAgent()",
  "error InsufficientBalance(uint256 available, uint256 requested)",
  "error ContractPaused()",
]);
const deployer = account("DEPLOYER").address;

const robots: { label: string; robot: Address; wallet: string }[] = [
  { label: "robot 1", robot: robotAddress("1"), wallet: "AGENT_1" },
  { label: "robot 2", robot: robotAddress("2"), wallet: "AGENT_2" },
  { label: "P1 demo robot", robot: getAddress(slice(keccak256(toHex("monaid-demo-robot-1")), 12)), wallet: "AGENT_1" },
];

let recovered = 0n;
let gas = 0n;
for (const r of robots) {
  const bal = (await publicClient.readContract({ address: V0, abi: V0_ABI, functionName: "balanceOf", args: [r.robot] })) as bigint;
  if (bal === 0n) {
    console.log(`• ${r.label}: 0 in v0 — skipped`);
    continue;
  }
  const res = await sendTx({
    wallet: r.wallet,
    action: "recoverV0",
    reason: `retire v0: return ${r.label}'s balance to DEPLOYER`,
    to: V0,
    abi: V0_ABI,
    functionName: "pay",
    args: [r.robot, deployer, bal],
  });
  console.log(describe(res, `${r.label}: ${formatEther(bal)} MON from v0 → DEPLOYER`));
  recovered += bal;
  gas += res.fee;
}
console.log(`\nRecovered ${formatEther(recovered)} MON to DEPLOYER for ${formatEther(gas)} MON gas.`);
