// Exports contract ABIs from Hardhat artifacts to shared/abi/<Name>.json for agents and teammates.
//
//   npm run export:abi
import hre from "hardhat";
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const CONTRACTS = ["MonaidCore"];
const OUT = join(__dirname, "..", "..", "shared", "abi");

async function main() {
  await hre.run("compile", { quiet: true });
  mkdirSync(OUT, { recursive: true });
  for (const name of CONTRACTS) {
    const { abi } = await hre.artifacts.readArtifact(name);
    writeFileSync(join(OUT, `${name}.json`), JSON.stringify(abi, null, 2) + "\n");
    console.log(`shared/abi/${name}.json  (${abi.length} entries)`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
