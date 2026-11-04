// Prints every configured wallet (from .env) and its MON balance on Monad testnet.
import hre from "hardhat";
import { formatEther } from "viem";

const NAMES = ["DEPLOYER", "AGENT_1"];

async function main() {
  const wallets = await hre.viem.getWalletClients();
  if (wallets.length === 0) throw new Error("No keys in agents/.env — run npm run wallet:new in agents/");
  const client = await hre.viem.getPublicClient();
  console.log(`Network: ${hre.network.name} (chainId ${await client.getChainId()})`);
  for (const [i, w] of wallets.entries()) {
    const bal = await client.getBalance({ address: w.account.address });
    console.log(`${(NAMES[i] ?? `#${i}`).padEnd(10)} ${w.account.address}  ${formatEther(bal)} MON`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
