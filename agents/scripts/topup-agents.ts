// npm run topup:agents [-- --dry-run]
// DEPLOYER refills agent wallets that are below the gas floor up to the target, within a daily cap.
// Every send checks the DEPLOYER floor first; stops (and prints DEPLOYER's address) if it can't.
import { formatEther } from "viem";
import { account, hasWallet } from "../src/env.js";
import { FLOORS, config, publicClient } from "../src/chain.js";
import { FloorError, assertDeployerCanSpend, mon, recordTopup, sendSimple, toppedUpToday, withMargin } from "../src/funding.js";

const dryRun = process.argv.includes("--dry-run");
let capLeft = FLOORS.agentDailyCap - toppedUpToday();
console.log(
  `Top-up rule: agents below ${mon(FLOORS.agentGas)} are refilled to ${mon(FLOORS.agentTarget)}; ` +
    `daily cap ${mon(FLOORS.agentDailyCap)}, ${mon(capLeft > 0n ? capLeft : 0n)} left today.${dryRun ? " (dry run)" : ""}\n`,
);

let sent = 0n;
try {
  for (const { agent: name } of config.robots) {
    if (!hasWallet(name)) {
      console.log(`• ${name}: no wallet in agents/.env — skipped`);
      continue;
    }
    const to = account(name).address;
    const balance = await publicClient.getBalance({ address: to });
    if (balance >= FLOORS.agentGas) {
      console.log(`• ${name} ${to}: ${mon(balance)} ≥ floor — ok`);
      continue;
    }
    let amount = FLOORS.agentTarget - balance;
    if (capLeft <= 0n) {
      console.log(`✖ ${name} ${to}: ${mon(balance)} below floor, but daily top-up cap is used up — skipped`);
      continue;
    }
    if (amount > capLeft) amount = capLeft;

    const gas = withMargin(await publicClient.estimateGas({ account: account("DEPLOYER"), to, value: amount }));
    await assertDeployerCanSpend(amount, gas, `topping up ${name} with ${Number(formatEther(amount)).toFixed(4)} MON`);
    if (dryRun) {
      console.log(`→ ${name} ${to}: would send ${mon(amount)} (${mon(balance)} → ${mon(balance + amount)})`);
      continue;
    }
    const { hash } = await sendSimple("DEPLOYER", `top up ${name} with ${mon(amount)}`, { to, value: amount }, { gas });
    recordTopup({ wallet: name, address: to, amountWei: amount, hash });
    capLeft -= amount;
    sent += amount;
  }
  console.log(`\nTopped up this run: ${mon(sent)}. Cap left today: ${mon(capLeft > 0n ? capLeft : 0n)}.`);
} catch (e) {
  console.error(e instanceof FloorError ? `\n${e.message}` : `Error: ${(e as Error).message}`);
  process.exitCode = 1;
}
