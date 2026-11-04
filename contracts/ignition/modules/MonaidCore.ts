import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("MonaidCoreModule", (m) => {
  const core = m.contract("MonaidCore");
  return { core };
});
