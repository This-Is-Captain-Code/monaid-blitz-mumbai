// Reserve-balance check: AGENT_1 sends one 0-value transaction to itself.
// Tells us whether a gas-only wallet below Monad's 10 MON reserve can still transact.
//
//   npm run reserve:check
import hre from "hardhat";
import { formatEther, formatGwei } from "viem";

const EXPLORER = "https://testnet.monadscan.com/tx/";

async function main() {
  const [, agent] = await hre.viem.getWalletClients();
  if (!agent) throw new Error("AGENT_1_PRIVATE_KEY missing");
  const pub = await hre.viem.getPublicClient();
  const me = agent.account.address;

  const before = await pub.getBalance({ address: me });
  const est = await pub.estimateGas({ account: me, to: me, value: 0n });
  const gas = (est * 115n) / 100n; // Monad charges the limit: estimate + 15%

  console.log(`AGENT_1 ${me}`);
  console.log(`balance before: ${formatEther(before)} MON (reserve is 10 MON)`);
  console.log(`gas estimate ${est}, limit ${gas}`);

  const hash = await agent.sendTransaction({ to: me, value: 0n, gas });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  const after = await pub.getBalance({ address: me });

  console.log(`\nstatus:  ${receipt.status}`);
  console.log(`tx:      ${hash}`);
  console.log(`         ${EXPLORER}${hash}`);
  console.log(`gas:     used ${receipt.gasUsed}, limit ${gas}, price ${formatGwei(receipt.effectiveGasPrice)} gwei`);
  console.log(`cost:    ${formatEther(before - after)} MON`);
  console.log(`balance after:  ${formatEther(after)} MON`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
