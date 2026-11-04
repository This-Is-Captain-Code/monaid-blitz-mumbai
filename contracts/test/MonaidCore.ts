import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther, zeroAddress } from "viem";

const ROBOT = getAddress("0x00000000000000000000000000000000000000b1");
const OTHER_ROBOT = getAddress("0x00000000000000000000000000000000000000b2");
const TECH = getAddress("0x0000000000000000000000000000000000007ec4");

async function setup() {
  const [owner, agent, stranger] = await hre.viem.getWalletClients();
  const core = await hre.viem.deployContract("MonaidCore");
  const asAgent = await hre.viem.getContractAt("MonaidCore", core.address, { client: { wallet: agent } });
  const asStranger = await hre.viem.getContractAt("MonaidCore", core.address, { client: { wallet: stranger } });
  const pub = await hre.viem.getPublicClient();
  await core.write.registerRobot([ROBOT, agent.account.address]);
  await core.write.fund([ROBOT], { value: parseEther("1") });
  return { core, asAgent, asStranger, pub, owner, agent, stranger };
}

describe("MonaidCore", () => {
  it("happy path: register, fund, agent pays, balances move", async () => {
    const { core, asAgent, pub, agent } = await setup();
    expect(await core.read.agentOf([ROBOT])).to.equal(getAddress(agent.account.address));
    expect(await core.read.balanceOf([ROBOT])).to.equal(parseEther("1"));

    const before = await pub.getBalance({ address: TECH });
    const hash = await asAgent.write.pay([ROBOT, TECH, parseEther("0.25")]);
    await pub.waitForTransactionReceipt({ hash });

    expect(await core.read.balanceOf([ROBOT])).to.equal(parseEther("0.75"));
    expect((await pub.getBalance({ address: TECH })) - before).to.equal(parseEther("0.25"));
    const paid = await core.getEvents.Paid();
    expect(paid).to.have.length(1);
    expect(paid[0].args).to.deep.equal({ robot: ROBOT, to: TECH, amount: parseEther("0.25") });
  });

  it("non-agent cannot pay (owner or stranger)", async () => {
    const { core, asStranger } = await setup();
    await expect(asStranger.write.pay([ROBOT, TECH, 1n])).to.be.rejectedWith("NotAgent");
    await expect(core.write.pay([ROBOT, TECH, 1n])).to.be.rejectedWith("NotAgent");
  });

  it("insufficient balance reverts", async () => {
    const { asAgent } = await setup();
    await expect(asAgent.write.pay([ROBOT, TECH, parseEther("2")])).to.be.rejectedWith("InsufficientBalance");
  });

  it("paused reverts pay and fund; unpause restores", async () => {
    const { core, asAgent, asStranger } = await setup();
    await expect(asStranger.write.pause()).to.be.rejectedWith("NotOwner");
    await core.write.pause();
    await expect(asAgent.write.pay([ROBOT, TECH, 1n])).to.be.rejectedWith("ContractPaused");
    await expect(core.write.fund([ROBOT], { value: 1n })).to.be.rejectedWith("ContractPaused");
    await core.write.unpause();
    await asAgent.write.pay([ROBOT, TECH, 1n]);
  });

  it("unregistered robot reverts on fund and pay", async () => {
    const { core, asAgent } = await setup();
    await expect(core.write.fund([OTHER_ROBOT], { value: 1n })).to.be.rejectedWith("RobotNotRegistered");
    await expect(asAgent.write.pay([OTHER_ROBOT, TECH, 1n])).to.be.rejectedWith("RobotNotRegistered");
  });

  it("guards: owner-only register, no double register, zero checks, plain transfers rejected", async () => {
    const { core, asAgent, asStranger, owner, agent } = await setup();
    await expect(asStranger.write.registerRobot([OTHER_ROBOT, agent.account.address])).to.be.rejectedWith("NotOwner");
    await expect(core.write.registerRobot([ROBOT, agent.account.address])).to.be.rejectedWith("RobotAlreadyRegistered");
    await expect(core.write.registerRobot([OTHER_ROBOT, zeroAddress])).to.be.rejectedWith("ZeroAddress");
    await expect(core.write.fund([ROBOT], { value: 0n })).to.be.rejectedWith("ZeroAmount");
    await expect(asAgent.write.pay([ROBOT, zeroAddress, 1n])).to.be.rejectedWith("ZeroAddress");
    await expect(owner.sendTransaction({ to: core.address, value: 1n })).to.be.rejectedWith("UseFund");
  });
});
