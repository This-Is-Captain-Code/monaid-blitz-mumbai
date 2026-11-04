// npm run topup:agents [-- --dry-run]
// DEPLOYER refills agent wallets that are below the gas floor up to the target, within a daily cap.
// Sends via sendTx, which checks the DEPLOYER floor first; stops (and prints DEPLOYER's address) if it can't.
import { account, hasWallet } from "../src/env.js";
import { FLOORS, config, publicClient } from "../src/chain.js";
import { FloorError, assertDeployerCanSpend, mon, recordTopup, toppedUpToday } from "../src/funding.js";
import { describe, sendTx } from "../src/tx.js";

const dryRun = process.argv.includes("--dry-run");
let capLeft = FLOORS.agentDailyCap - toppedUpToday();
console.log(
  `Top-up rule: agents below ${mon(FLOORS.agentGas)} are refilled to ${mon(FLOORS.agentTarget)}; ` +
    `daily cap ${mon(FLOORS.agentDailyCap)}, ${mon(capLeft > 0n ? capLeft : 0n)} left today.${dryRun ? " (dry run)" : ""}\n`,
);

let sent = 0n;
try {
  for (const { id, agent: name } of config.robots) {
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
    if (capLeft <= 0n) {
      console.log(`✖ ${name} ${to}: ${mon(balance)} below floor, but daily top-up cap is used up — skipped`);
      continue;
    }
    let amount = FLOORS.agentTarget - balance;
    if (amount > capLeft) amount = capLeft;

    if (dryRun) {
      await assertDeployerCanSpend(amount, 25_000n, `topping up ${name} with ${mon(amount)}`);
      console.log(`→ ${name} ${to}: would send ${mon(amount)} (${mon(balance)} → ${mon(balance + amount)})`);
      continue;
    }
    const res = await sendTx({
      wallet: "DEPLOYER",
      robot: id,
      action: "topup",
      reason: `${name} below ${mon(FLOORS.agentGas)} gas floor`,
      to,
      value: amount,
    });
    console.log(describe(res, `top up ${name} with ${mon(amount)}`));
    recordTopup({ wallet: name, address: to, amountWei: amount, hash: res.hash });
    capLeft -= amount;
    sent += amount;
  }
  console.log(`\nTopped up this run: ${mon(sent)}. Cap left today: ${mon(capLeft > 0n ? capLeft : 0n)}.`);
} catch (e) {
  console.error(e instanceof FloorError ? `\n${e.message}` : `Error: ${(e as Error).message}`);
  process.exitCode = 1;
}
