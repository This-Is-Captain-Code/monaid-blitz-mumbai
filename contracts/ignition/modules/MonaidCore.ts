import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseEther } from "viem";

// v1 (jobs). A new module id so Ignition deploys a fresh contract instead of reconciling with v0.
export default buildModule("MonaidCoreV1Module", (m) => {
  const maxPayout = m.getParameter("maxPayout", parseEther("0.1"));
  const core = m.contract("MonaidCore", [maxPayout]);
  return { core };
});
