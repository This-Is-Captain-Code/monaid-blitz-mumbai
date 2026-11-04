import { expect } from "chai";
import hre from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { getAddress, parseEther, zeroAddress } from "viem";

const ROBOT = getAddress("0x00000000000000000000000000000000000000b1");
const OTHER_ROBOT = getAddress("0x00000000000000000000000000000000000000b2");
const WORKER = getAddress("0x0000000000000000000000000000000000007ec4");
const MAX = parseEther("0.1");
const WINDOW = 60n; // seconds

async function setup() {
  const [owner, agent, stranger] = await hre.viem.getWalletClients();
  const core = await hre.viem.deployContract("MonaidCore", [MAX]);
  const as = async (w: typeof owner) => hre.viem.getContractAt("MonaidCore", core.address, { client: { wallet: w } });
  const asAgent = await as(agent);
  const asStranger = await as(stranger);
  const pub = await hre.viem.getPublicClient();
  await core.write.registerRobot([ROBOT, agent.account.address]);
  await core.write.fund([ROBOT], { value: parseEther("1") });
  return { core, asAgent, asStranger, pub, owner, agent, stranger };
}

/** Posts a 0.05 MON job and returns its id. */
async function post(asAgent: Awaited<ReturnType<typeof setup>>["asAgent"], payout = parseEther("0.05")) {
  await asAgent.write.postJob([ROBOT, payout, WINDOW]);
  return await asAgent.read.jobCount();
}

describe("MonaidCore v1 — money", () => {
  it("register, fund, direct pay within the cap", async () => {
    const { core, asAgent, pub, agent } = await setup();
    expect(await core.read.agentOf([ROBOT])).to.equal(getAddress(agent.account.address));
    expect(await core.read.maxPayout()).to.equal(MAX);
    const before = await pub.getBalance({ address: WORKER });
    await asAgent.write.pay([ROBOT, WORKER, parseEther("0.05")]);
    expect(await core.read.balanceOf([ROBOT])).to.equal(parseEther("0.95"));
    expect((await pub.getBalance({ address: WORKER })) - before).to.equal(parseEther("0.05"));
  });

  it("pay: NotRobotAgent, PayoutTooHigh, InsufficientBalance, RobotNotRegistered", async () => {
    const { core, asAgent, asStranger } = await setup();
    await expect(asStranger.write.pay([ROBOT, WORKER, 1n])).to.be.rejectedWith("NotRobotAgent");
    await expect(core.write.pay([ROBOT, WORKER, 1n])).to.be.rejectedWith("NotRobotAgent");
    await expect(asAgent.write.pay([ROBOT, WORKER, MAX + 1n])).to.be.rejectedWith("PayoutTooHigh");
    await core.write.setMaxPayout([parseEther("5")]);
    await expect(asAgent.write.pay([ROBOT, WORKER, parseEther("2")])).to.be.rejectedWith("InsufficientBalance");
    await expect(asAgent.write.pay([OTHER_ROBOT, WORKER, 1n])).to.be.rejectedWith("RobotNotRegistered");
  });

  it("guards: owner-only admin, no double register, zero checks, plain transfers rejected", async () => {
    const { core, asAgent, asStranger, owner, agent } = await setup();
    await expect(asStranger.write.registerRobot([OTHER_ROBOT, agent.account.address])).to.be.rejectedWith("NotOwner");
    await expect(asStranger.write.setMaxPayout([1n])).to.be.rejectedWith("NotOwner");
    await expect(asStranger.write.pause()).to.be.rejectedWith("NotOwner");
    await expect(core.write.registerRobot([ROBOT, agent.account.address])).to.be.rejectedWith("RobotAlreadyRegistered");
    await expect(core.write.registerRobot([OTHER_ROBOT, zeroAddress])).to.be.rejectedWith("ZeroAddress");
    await expect(core.write.fund([ROBOT], { value: 0n })).to.be.rejectedWith("ZeroAmount");
    await expect(core.write.fund([OTHER_ROBOT], { value: 1n })).to.be.rejectedWith("RobotNotRegistered");
    await expect(asAgent.write.postJob([ROBOT, 1n, 0n])).to.be.rejectedWith("ZeroWindow");
    await expect(owner.sendTransaction({ to: core.address, value: 1n })).to.be.rejectedWith("UseFund");
  });
});

describe("MonaidCore v1 — jobs", () => {
  it("happy path: post (escrow) → claim → settle pays the worker", async () => {
    const { core, asAgent, pub } = await setup();
    const id = await post(asAgent);
    expect(await core.read.balanceOf([ROBOT])).to.equal(parseEther("0.95"));
    expect(await core.read.escrowOf([ROBOT])).to.equal(parseEther("0.05"));

    await asAgent.write.claim([id, WORKER]);
    const job = await core.read.getJob([id]);
    expect(job.status).to.equal(2); // Claimed
    expect(job.worker).to.equal(WORKER);
    expect(await core.read.claimDeadline([id])).to.equal(job.claimedAt + WINDOW);

    const before = await pub.getBalance({ address: WORKER });
    await asAgent.write.settle([id]);
    expect((await pub.getBalance({ address: WORKER })) - before).to.equal(parseEther("0.05"));
    expect(await core.read.escrowOf([ROBOT])).to.equal(0n);
    expect((await core.read.getJob([id])).status).to.equal(3); // Settled
    const [ev] = await core.getEvents.JobSettled();
    expect(ev.args).to.deep.equal({ jobId: id, worker: WORKER, payout: parseEther("0.05") });
  });

  it("fail path: claim → window passes → anyone expires → escrow back to the robot", async () => {
    const { core, asAgent, asStranger } = await setup();
    const id = await post(asAgent);
    await asAgent.write.claim([id, WORKER]);
    await expect(asStranger.write.expire([id])).to.be.rejectedWith("ClaimNotExpired");

    await time.increase(Number(WINDOW) + 1);
    await expect(asAgent.write.settle([id])).to.be.rejectedWith("ClaimExpired");
    await asStranger.write.expire([id]); // anyone
    expect((await core.read.getJob([id])).status).to.equal(4); // Expired
    expect(await core.read.balanceOf([ROBOT])).to.equal(parseEther("1"));
    expect(await core.read.escrowOf([ROBOT])).to.equal(0n);
    await expect(asAgent.write.settle([id])).to.be.rejectedWith("ClaimExpired");
    await expect(asStranger.write.expire([id])).to.be.rejectedWith("JobNotClaimed");
  });

  it("NotRobotAgent: only the robot's agent posts, claims, settles, cancels", async () => {
    const { core, asAgent, asStranger } = await setup();
    await expect(asStranger.write.postJob([ROBOT, 1n, WINDOW])).to.be.rejectedWith("NotRobotAgent");
    await expect(core.write.postJob([ROBOT, 1n, WINDOW])).to.be.rejectedWith("NotRobotAgent");
    const id = await post(asAgent);
    await expect(asStranger.write.claim([id, WORKER])).to.be.rejectedWith("NotRobotAgent");
    await expect(asStranger.write.cancel([id])).to.be.rejectedWith("NotRobotAgent");
    await asAgent.write.claim([id, WORKER]);
    await expect(asStranger.write.settle([id])).to.be.rejectedWith("NotRobotAgent");
  });

  it("PayoutTooHigh and InsufficientBalance on post; setMaxPayout moves the cap", async () => {
    const { core, asAgent } = await setup();
    await expect(asAgent.write.postJob([ROBOT, MAX + 1n, WINDOW])).to.be.rejectedWith("PayoutTooHigh");
    await core.write.setMaxPayout([parseEther("5")]);
    await expect(asAgent.write.postJob([ROBOT, parseEther("2"), WINDOW])).to.be.rejectedWith("InsufficientBalance");
    await asAgent.write.postJob([ROBOT, parseEther("0.6"), WINDOW]);
    // escrow is locked: a second job can't reuse it
    await expect(asAgent.write.postJob([ROBOT, parseEther("0.6"), WINDOW])).to.be.rejectedWith("InsufficientBalance");
  });

  it("JobNotOpen: claim twice, cancel a claimed job; cancel returns escrow", async () => {
    const { core, asAgent } = await setup();
    const id = await post(asAgent);
    await asAgent.write.claim([id, WORKER]);
    await expect(asAgent.write.claim([id, WORKER])).to.be.rejectedWith("JobNotOpen");
    await expect(asAgent.write.cancel([id])).to.be.rejectedWith("JobNotOpen");

    const id2 = await post(asAgent);
    await asAgent.write.cancel([id2]);
    expect((await core.read.getJob([id2])).status).to.equal(5); // Cancelled
    expect(await core.read.escrowOf([ROBOT])).to.equal(parseEther("0.05")); // only job 1 still escrowed
    await expect(asAgent.write.claim([id2, WORKER])).to.be.rejectedWith("JobNotOpen");
  });

  it("JobNotClaimed and AlreadySettled; JobNotFound for unknown ids", async () => {
    const { asAgent } = await setup();
    const id = await post(asAgent);
    await expect(asAgent.write.settle([id])).to.be.rejectedWith("JobNotClaimed");
    await asAgent.write.claim([id, WORKER]);
    await asAgent.write.settle([id]);
    await expect(asAgent.write.settle([id])).to.be.rejectedWith("AlreadySettled");
    await expect(asAgent.write.expire([id])).to.be.rejectedWith("AlreadySettled");
    await expect(asAgent.write.settle([999n])).to.be.rejectedWith("JobNotFound");
  });

  it("Paused blocks fund, pay, postJob, claim and settle; unpause restores", async () => {
    const { core, asAgent } = await setup();
    const open = await post(asAgent);
    const claimed = await post(asAgent);
    await asAgent.write.claim([claimed, WORKER]);

    await core.write.pause();
    await expect(core.write.fund([ROBOT], { value: 1n })).to.be.rejectedWith("Paused");
    await expect(asAgent.write.pay([ROBOT, WORKER, 1n])).to.be.rejectedWith("Paused");
    await expect(asAgent.write.postJob([ROBOT, 1n, WINDOW])).to.be.rejectedWith("Paused");
    await expect(asAgent.write.claim([open, WORKER])).to.be.rejectedWith("Paused");
    await expect(asAgent.write.settle([claimed])).to.be.rejectedWith("Paused");

    await core.write.unpause();
    await asAgent.write.claim([open, WORKER]);
    await asAgent.write.settle([open]);
  });

  it("cancel works while paused (escrow back to the robot)", async () => {
    const { core, asAgent, asStranger } = await setup();
    const open = await post(asAgent);
    await core.write.pause();
    await expect(asStranger.write.cancel([open])).to.be.rejectedWith("NotRobotAgent"); // still agent-only
    await asAgent.write.cancel([open]);
    expect((await core.read.getJob([open])).status).to.equal(5); // Cancelled
    expect(await core.read.balanceOf([ROBOT])).to.equal(parseEther("1"));
    expect(await core.read.escrowOf([ROBOT])).to.equal(0n);
  });

  it("expire works while paused and is callable by anyone (not just the agent or owner)", async () => {
    const { core, asAgent, asStranger } = await setup();
    const claimed = await post(asAgent);
    await asAgent.write.claim([claimed, WORKER]);
    await core.write.pause();
    await expect(asStranger.write.expire([claimed])).to.be.rejectedWith("ClaimNotExpired"); // window rule still applies
    await time.increase(Number(WINDOW) + 1);
    await asStranger.write.expire([claimed]); // a stranger, while paused
    expect((await core.read.getJob([claimed])).status).to.equal(4); // Expired
    expect(await core.read.balanceOf([ROBOT])).to.equal(parseEther("1"));
    expect(await core.read.escrowOf([ROBOT])).to.equal(0n);
    const [ev] = await core.getEvents.JobExpired();
    expect(ev.args.jobId).to.equal(claimed);
  });
});
