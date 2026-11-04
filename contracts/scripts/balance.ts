// Prints the deployer address and its MON balance on Monad testnet.
import hre from "hardhat";
import { formatEther } from "viem";

async function main() {
  const [wallet] = await hre.viem.getWalletClients();
  if (!wallet) throw new Error("No PRIVATE_KEY set in contracts/.env");
  const client = await hre.viem.getPublicClient();
  const balance = await client.getBalance({ address: wallet.account.address });
  console.log(`Network: ${hre.network.name} (chainId ${await client.getChainId()})`);
  console.log(`Address: ${wallet.account.address}`);
  console.log(`Balance: ${formatEther(balance)} MON`);
  if (balance === 0n) console.log("Empty — claim testnet MON at https://faucet.monad.xyz");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
