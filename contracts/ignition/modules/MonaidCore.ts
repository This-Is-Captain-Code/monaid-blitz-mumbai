import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseEther } from "viem";

// v1.1 (jobs; cancel/expire work while paused). New module id per version so Ignition deploys fresh
// instead of reconciling with an older deployment (v0: MonaidCoreModule, v1: MonaidCoreV1Module).
export default buildModule("MonaidCoreV1_1Module", (m) => {
  const maxPayout = m.getParameter("maxPayout", parseEther("0.1"));
  const core = m.contract("MonaidCore", [maxPayout]);
  return { core };
});
