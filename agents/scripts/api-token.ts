// npm run api:token [-- --rotate] — writes MONAID_API_TOKEN to agents/.env. Never prints it.
// Share it with teammates privately by reading it from agents/.env.
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ENV_PATH, readEnv, readEnvText } from "../src/env.js";

const rotate = process.argv.includes("--rotate");
if (readEnv().MONAID_API_TOKEN && !rotate) {
  console.log("MONAID_API_TOKEN already set in agents/.env — not changed (use --rotate to replace it).");
  process.exit(0);
}
const token = randomBytes(24).toString("base64url");
let text = readEnvText();
const line = /^MONAID_API_TOKEN=.*$/m;
text = line.test(text) ? text.replace(line, `MONAID_API_TOKEN=${token}`) : text + (text && !text.endsWith("\n") ? "\n" : "") + `MONAID_API_TOKEN=${token}\n`;
writeFileSync(ENV_PATH, text, { mode: 0o600 });
console.log(`MONAID_API_TOKEN ${rotate ? "rotated" : "created"} in agents/.env (${token.length} chars). Not printed — read it from the file.`);
