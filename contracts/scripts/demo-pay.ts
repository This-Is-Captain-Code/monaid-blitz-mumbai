// Step 1 demo: register a robot, fund it, and have its agent pay a test address — all on Monad testnet.
// Reads the MonaidCore address from shared/addresses.json. Safe to re-run (skips registration if done).
//
//   npm run demo:pay
import hre from "hardhat";
import { readFileSync } from "fs";
import { join } from "path";
import { formatEther, getAddress, keccak256, parseEther, slice, toHex, type Hash } from "viem";

const EXPLORER = "https://testnet.monadscan.com/tx/";
const FUND_AMOUNT = parseEther("0.01");
const PAY_AMOUNT = parseEther("0.005");

// Throwaway demo addresses (no keys exist for them). Real robots get registered with their device address.
const demoAddr = (label: string) => getAddress(slice(keccak256(toHex(label)), 12));
const ROBOT = demoAddr("monaid-demo-robot-1");
const TECH = demoAddr("monaid-demo-technician");

/** Monad charges the gas LIMIT, so estimate and add ~15% instead of using a big fixed limit. */
const withMargin = (est: bigint) => (est * 115n) / 100n;

async function main() {
  const shared = JSON.parse(readFileSync(join(__dirname, "..", "..", "shared", "addresses.json"), "utf8"));
  const coreAddress = getAddress(shared.monadTestnet.MonaidCore.address);

  const [deployer, agent] = await hre.viem.getWalletClients();
  if (!deployer || !agent) throw new Error("Need DEPLOYER and AGENT_1 keys in contracts/.env");
  const pub = await hre.viem.getPublicClient();
  const asOwner = await hre.viem.getContractAt("MonaidCore", coreAddress, { client: { wallet: deployer } });
  const asAgent = await hre.viem.getContractAt("MonaidCore", coreAddress, { client: { wallet: agent } });

  const startBal = {
    deployer: await pub.getBalance({ address: deployer.account.address }),
    agent: await pub.getBalance({ address: agent.account.address }),
  };
  let spentGas = 0n;

  const send = async (label: string, hash: Hash) => {
    const r = await pub.waitForTransactionReceipt({ hash });
    const tx = await pub.getTransaction({ hash });
    const fee = tx.gas * r.effectiveGasPrice; // what Monad actually charges (limit × price)
    spentGas += fee;
    if (r.status !== "success") throw new Error(`${label} reverted: ${EXPLORER}${hash}`);
    console.log(`✔ ${label}\n    tx  ${hash}\n    ${EXPLORER}${hash}\n    gas ${r.gasUsed}/${tx.gas} limit, fee ${formatEther(fee)} MON`);
  };

  console.log(`MonaidCore ${coreAddress}`);
  console.log(`Robot      ${ROBOT} (demo)\nAgent      ${agent.account.address}\nTechnician ${TECH} (demo)\n`);

  // 1. register (owner) — skip if already registered to this agent
  const current = await asOwner.read.agentOf([ROBOT]);
  if (current === "0x0000000000000000000000000000000000000000") {
    const gas = withMargin(await asOwner.estimateGas.registerRobot([ROBOT, agent.account.address], { account: deployer.account }));
    await send("registerRobot", await asOwner.write.registerRobot([ROBOT, agent.account.address], { gas }));
  } else if (getAddress(current) !== getAddress(agent.account.address)) {
    throw new Error(`Robot already registered to a different agent: ${current}`);
  } else {
    console.log("• robot already registered to AGENT_1, skipping registerRobot");
  }

  // 2. fund (anyone; here the deployer)
  {
    const gas = withMargin(await asOwner.estimateGas.fund([ROBOT], { account: deployer.account, value: FUND_AMOUNT }));
    await send(`fund ${formatEther(FUND_AMOUNT)} MON`, await asOwner.write.fund([ROBOT], { value: FUND_AMOUNT, gas }));
  }

  // 3. pay (agent only)
  {
    const gas = withMargin(await asAgent.estimateGas.pay([ROBOT, TECH, PAY_AMOUNT], { account: agent.account }));
    await send(`pay ${formatEther(PAY_AMOUNT)} MON -> technician`, await asAgent.write.pay([ROBOT, TECH, PAY_AMOUNT], { gas }));
  }

  const endBal = {
    deployer: await pub.getBalance({ address: deployer.account.address }),
    agent: await pub.getBalance({ address: agent.account.address }),
  };
  console.log(`\nRobot balance in MonaidCore: ${formatEther(await asOwner.read.balanceOf([ROBOT]))} MON`);
  console.log(`Technician wallet:           ${formatEther(await pub.getBalance({ address: TECH }))} MON`);
  console.log(`Gas spent this run:          ${formatEther(spentGas)} MON`);
  console.log(`DEPLOYER ${formatEther(startBal.deployer)} -> ${formatEther(endBal.deployer)} MON`);
  console.log(`AGENT_1  ${formatEther(startBal.agent)} -> ${formatEther(endBal.agent)} MON`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
