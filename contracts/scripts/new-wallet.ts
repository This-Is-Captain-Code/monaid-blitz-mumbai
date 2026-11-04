// Creates named wallets and writes their private keys straight into contracts/.env.
// Prints addresses only — never the key. Refuses to overwrite an existing key.
//
//   npm run wallet:new                 -> DEPLOYER and AGENT_1
//   npm run wallet:new -- AGENT_2      -> just AGENT_2
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ENV_PATH = join(__dirname, "..", ".env");
const names = process.argv.slice(2).map((n) => n.toUpperCase());
if (names.length === 0) names.push("DEPLOYER", "AGENT_1");

let env = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "";
let refused = false;

for (const name of names) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Bad wallet name: ${name}`);
  const key = `${name}_PRIVATE_KEY`;
  const line = new RegExp(`^${key}=(.*)$`, "m");
  const existing = env.match(line)?.[1]?.trim();

  if (existing) {
    const addr = privateKeyToAccount(existing as `0x${string}`).address;
    console.log(`${name.padEnd(10)} ${addr}  (already in .env — NOT overwritten)`);
    refused = true;
    continue;
  }

  const pk = generatePrivateKey();
  const entry = `${key}=${pk}`;
  env = line.test(env)
    ? env.replace(line, entry)
    : env + (env && !env.endsWith("\n") ? "\n" : "") + entry + "\n";
  console.log(`${name.padEnd(10)} ${privateKeyToAccount(pk).address}  (new, key saved to .env)`);
}

writeFileSync(ENV_PATH, env, { mode: 0o600 });
if (refused) process.exitCode = 1;
