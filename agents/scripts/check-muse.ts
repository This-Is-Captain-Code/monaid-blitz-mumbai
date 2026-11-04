// npm run check:agent-decision (aliases check:claude, check:muse) — one real decision via OpenRouter (needs OPENROUTER_API_KEY in agents/.env).
// Sends no transactions. Prints Muse's choice + reason, or the fallback and why.
import { MUSE_CFG, agentLabel, museDecide, ownerContext } from "../src/muse.js";

const decision = {
  question: "Both robots crashed at the same time. Which robot gets help first?",
  options: [
    { id: "robot-1", label: "Robot 1 (T-Deck): crashed", detail: "job payout 0.01 MON" },
    { id: "robot-2", label: "Robot 2 (Watcher): crashed", detail: "job payout 0.01 MON" },
  ],
};
console.log(`${agentLabel()} via OpenRouter · model ${MUSE_CFG.model} · reasoning ${MUSE_CFG.reasoningEffort} · timeout ${MUSE_CFG.timeoutMs} ms`);
console.log("owner context:", JSON.stringify(ownerContext()));
console.log("decision:", JSON.stringify(decision), "\n");
const r = await museDecide(decision);
console.log(r.source === "agent" ? `✔ ${r.by} chose ${r.choice} in ${r.ms} ms — "${r.reason}" (${r.model})` : `↩ owner decides (${r.fallback}, ${r.ms} ms): ${r.detail}`);
