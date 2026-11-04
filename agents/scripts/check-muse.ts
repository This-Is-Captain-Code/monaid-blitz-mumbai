// npm run check:muse — one real Muse decision against the Claude API (needs ANTHROPIC_API_KEY in agents/.env).
// Sends no transactions. Prints Muse's choice + reason, or the fallback and why.
import { MUSE_CFG, museDecide, ownerContext } from "../src/muse.js";

const decision = {
  question: "Both robots crashed at the same time. Which robot gets help first?",
  options: [
    { id: "robot-1", label: "Robot 1 (T-Deck): crashed", detail: "job payout 0.01 MON" },
    { id: "robot-2", label: "Robot 2 (Watcher): crashed", detail: "job payout 0.01 MON" },
  ],
};
console.log(`model ${MUSE_CFG.model} · effort ${MUSE_CFG.effort} · timeout ${MUSE_CFG.timeoutMs} ms`);
console.log("owner context:", JSON.stringify(ownerContext()));
console.log("decision:", JSON.stringify(decision), "\n");
const r = await museDecide(decision);
console.log(r.source === "muse" ? `✔ Muse chose ${r.choice} in ${r.ms} ms — "${r.reason}" (${r.model})` : `↩ owner decides (${r.fallback}, ${r.ms} ms): ${r.detail}`);
