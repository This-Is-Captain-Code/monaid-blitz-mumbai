import { expect } from "chai";
import hre from "hardhat";

describe("Greeter", () => {
  it("stores and updates the greeting", async () => {
    const greeter = await hre.viem.deployContract("Greeter", ["gm Monad"]);
    expect(await greeter.read.greeting()).to.equal("gm Monad");
    await greeter.write.setGreeting(["gn"]);
    expect(await greeter.read.greeting()).to.equal("gn");
  });
});
