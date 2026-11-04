// npm run wallet:new -- <NAME> [NAME...]
// Creates a wallet, writes its key to agents/.env, prints the address only. Refuses to overwrite.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { account, assertWalletName, hasWallet, storeNewKey } from "../src/env.js";
import { roleOf } from "../src/chain.js";

const names = process.argv.slice(2).map((n) => n.toUpperCase());
if (names.length === 0) {
  console.error("Usage: npm run wallet:new -- <NAME>   e.g. AGENT_2");
  process.exit(1);
}

let refused = false;
for (const name of names) {
  assertWalletName(name);
  if (hasWallet(name)) {
    console.log(`${name.padEnd(10)} ${account(name).address}  already exists — NOT overwritten`);
    refused = true;
    continue;
  }
  const pk = generatePrivateKey();
  storeNewKey(name, pk);
  console.log(`${name.padEnd(10)} ${privateKeyToAccount(pk).address}  created (${roleOf(name)}), key in agents/.env`);
}
if (refused) process.exitCode = 1;
