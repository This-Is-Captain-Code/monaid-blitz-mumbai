// Generates a fresh deployer wallet. Paste the private key into .env, then
// fund the address at https://faucet.monad.xyz
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);
console.log(`Address:     ${account.address}`);
console.log(`Private key: ${pk}`);
console.log("\nAdd to contracts/.env as PRIVATE_KEY=..., then claim MON at https://faucet.monad.xyz");
