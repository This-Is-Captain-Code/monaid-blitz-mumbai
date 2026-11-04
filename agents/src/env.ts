// agents/.env is the ONE place private keys live. This module reads and writes it.
// Keys are never printed or logged; callers get accounts/addresses only.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

export const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ENV_PATH = join(AGENTS_DIR, ".env");
const SUFFIX = "_PRIVATE_KEY";

export const readEnvText = () => (existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf8") : "");
/** Secrets/settings we read: from agents/.env locally, or from the host's environment (e.g. Render) where there is no file. */
const ENV_KEYS = /^(?:[A-Z][A-Z0-9_]*_PRIVATE_KEY|MONAID_API_TOKEN|OPENROUTER_API_KEY|MONAID_RPC_URL|MONAID_KILL|CORS_ORIGIN)$/;
export const readEnv = (): Record<string, string> => {
  const fromHost = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => ENV_KEYS.test(k) && v)) as Record<string, string>;
  return { ...fromHost, ...parse(readEnvText()) }; // the local file wins when both exist
};

export function assertWalletName(name: string) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Bad wallet name "${name}" (use e.g. DEPLOYER, AGENT_2)`);
}

/** Wallet names present in agents/.env (DEPLOYER first). */
export function walletNames(): string[] {
  const names = Object.entries(readEnv())
    .filter(([k, v]) => k.endsWith(SUFFIX) && v.trim())
    .map(([k]) => k.slice(0, -SUFFIX.length));
  return names.sort((a, b) => (a === "DEPLOYER" ? -1 : b === "DEPLOYER" ? 1 : a.localeCompare(b, "en", { numeric: true })));
}

export function account(name: string): PrivateKeyAccount {
  assertWalletName(name);
  const pk = readEnv()[`${name}${SUFFIX}`]?.trim();
  if (!pk) throw new Error(`No ${name}${SUFFIX} in agents/.env — run: npm run wallet:new -- ${name}`);
  return privateKeyToAccount(pk as `0x${string}`);
}

export const hasWallet = (name: string) => !!readEnv()[`${name}${SUFFIX}`]?.trim();

/** Adds NAME_PRIVATE_KEY=<key>. Refuses if one exists. Returns nothing about the key. */
export function storeNewKey(name: string, pk: `0x${string}`) {
  assertWalletName(name);
  if (hasWallet(name)) throw new Error(`${name} already exists in agents/.env — refusing to overwrite`);
  let text = readEnvText();
  const key = `${name}${SUFFIX}`;
  const line = new RegExp(`^${key}=.*$`, "m");
  text = line.test(text) ? text.replace(line, `${key}=${pk}`) : text + (text && !text.endsWith("\n") ? "\n" : "") + `${key}=${pk}\n`;
  writeFileSync(ENV_PATH, text, { mode: 0o600 });
}
