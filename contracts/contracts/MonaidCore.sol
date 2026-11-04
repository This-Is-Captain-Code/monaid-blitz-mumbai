// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title MonaidCore v1 — robot balances in MON, jobs with escrow, claims that expire.
/// @notice A robot's agent posts a job (payout escrowed from the robot's balance), records the worker's claim,
///         and settles when the device proves the fix. If the claim window passes without a settle, anyone can
///         expire the job and the escrow returns to the robot. Every revert is a named custom error.
contract MonaidCore {
    // ---------- errors (every revert is a demo beat: short, human names) ----------
    error NotOwner();
    error NotRobotAgent();
    error RobotNotRegistered();
    error RobotAlreadyRegistered();
    error ZeroAddress();
    error ZeroAmount();
    error ZeroWindow();
    error InsufficientBalance(uint256 available, uint256 requested);
    error PayoutTooHigh(uint256 payout, uint256 maxPayout);
    error Paused();
    error TransferFailed();
    error UseFund();
    error JobNotFound();
    error JobNotOpen();
    error JobNotClaimed();
    error ClaimExpired();
    error ClaimNotExpired();
    error AlreadySettled();

    // ---------- events ----------
    event RobotRegistered(address indexed robot, address indexed agent);
    event Funded(address indexed robot, address indexed from, uint256 amount);
    event Paid(address indexed robot, address indexed to, uint256 amount);
    event PauseChanged(bool paused, address indexed by);
    event MaxPayoutChanged(uint256 maxPayout);
    event JobPosted(uint256 indexed jobId, address indexed robot, uint256 payout, uint64 claimWindow);
    event JobClaimed(uint256 indexed jobId, address indexed worker, uint64 deadline);
    event JobSettled(uint256 indexed jobId, address indexed worker, uint256 payout);
    event JobExpired(uint256 indexed jobId, address indexed worker, uint256 refunded);
    event JobCancelled(uint256 indexed jobId, uint256 refunded);

    // ---------- state ----------
    enum Status {
        None,
        Open,
        Claimed,
        Settled,
        Expired,
        Cancelled
    }

    struct Job {
        address robot;
        uint64 claimWindow; // seconds a claim stays valid
        uint64 claimedAt; // 0 until claimed
        Status status;
        address worker;
        uint256 payout;
    }

    address public immutable owner;
    bool public paused;
    uint256 public maxPayout;
    uint256 public jobCount;

    mapping(address robot => address agent) public agentOf;
    mapping(address robot => uint256) private _balances; // free balance
    mapping(address robot => uint256) public escrowOf; // locked in open/claimed jobs
    mapping(uint256 jobId => Job) private _jobs;

    constructor(uint256 _maxPayout) {
        owner = msg.sender;
        maxPayout = _maxPayout;
        emit MaxPayoutChanged(_maxPayout);
    }

    // ---------- modifiers ----------

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier registered(address robot) {
        if (agentOf[robot] == address(0)) revert RobotNotRegistered();
        _;
    }

    function _onlyAgentOf(address robot) private view {
        if (agentOf[robot] == address(0)) revert RobotNotRegistered();
        if (msg.sender != agentOf[robot]) revert NotRobotAgent();
    }

    function _job(uint256 jobId) private view returns (Job storage j) {
        j = _jobs[jobId];
        if (j.status == Status.None) revert JobNotFound();
    }

    function _send(address to, uint256 amount) private {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ---------- owner ----------

    function registerRobot(address robot, address agent) external onlyOwner {
        if (robot == address(0) || agent == address(0)) revert ZeroAddress();
        if (agentOf[robot] != address(0)) revert RobotAlreadyRegistered();
        agentOf[robot] = agent;
        emit RobotRegistered(robot, agent);
    }

    function setMaxPayout(uint256 _maxPayout) external onlyOwner {
        maxPayout = _maxPayout;
        emit MaxPayoutChanged(_maxPayout);
    }

    function pause() external onlyOwner {
        paused = true;
        emit PauseChanged(true, msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PauseChanged(false, msg.sender);
    }

    // ---------- money in / direct pay ----------

    /// @notice Anyone can top up a registered robot's balance.
    function fund(address robot) external payable whenNotPaused registered(robot) {
        if (msg.value == 0) revert ZeroAmount();
        _balances[robot] += msg.value;
        emit Funded(robot, msg.sender, msg.value);
    }

    /// @notice Direct payment by the robot's agent, outside a job. Capped by maxPayout like any job.
    function pay(address robot, address to, uint256 amount) external whenNotPaused {
        _onlyAgentOf(robot);
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > maxPayout) revert PayoutTooHigh(amount, maxPayout);
        uint256 available = _balances[robot];
        if (amount > available) revert InsufficientBalance(available, amount);
        _balances[robot] = available - amount;
        emit Paid(robot, to, amount);
        _send(to, amount);
    }

    // ---------- jobs ----------

    /// @notice Robot's agent posts a job; the payout is escrowed from the robot's balance now.
    function postJob(address robot, uint256 payout, uint64 claimWindow) external whenNotPaused returns (uint256 jobId) {
        _onlyAgentOf(robot);
        if (payout == 0) revert ZeroAmount();
        if (claimWindow == 0) revert ZeroWindow();
        if (payout > maxPayout) revert PayoutTooHigh(payout, maxPayout);
        uint256 available = _balances[robot];
        if (payout > available) revert InsufficientBalance(available, payout);

        _balances[robot] = available - payout;
        escrowOf[robot] += payout;
        jobId = ++jobCount;
        _jobs[jobId] = Job({
            robot: robot,
            claimWindow: claimWindow,
            claimedAt: 0,
            status: Status.Open,
            worker: address(0),
            payout: payout
        });
        emit JobPosted(jobId, robot, payout, claimWindow);
    }

    /// @notice Robot's agent records which worker claimed the job. The claim expires after claimWindow.
    function claim(uint256 jobId, address worker) external whenNotPaused {
        Job storage j = _job(jobId);
        _onlyAgentOf(j.robot);
        if (j.status != Status.Open) revert JobNotOpen();
        if (worker == address(0)) revert ZeroAddress();
        j.status = Status.Claimed;
        j.worker = worker;
        j.claimedAt = uint64(block.timestamp);
        emit JobClaimed(jobId, worker, uint64(block.timestamp) + j.claimWindow);
    }

    /// @notice Robot's agent attests the device proof; the escrowed payout goes to the worker.
    function settle(uint256 jobId) external whenNotPaused {
        Job storage j = _job(jobId);
        _onlyAgentOf(j.robot);
        if (j.status == Status.Settled) revert AlreadySettled();
        if (j.status == Status.Expired) revert ClaimExpired();
        if (j.status != Status.Claimed) revert JobNotClaimed();
        if (block.timestamp > uint256(j.claimedAt) + j.claimWindow) revert ClaimExpired();

        uint256 payout = j.payout;
        address worker = j.worker;
        j.status = Status.Settled;
        escrowOf[j.robot] -= payout;
        emit JobSettled(jobId, worker, payout);
        _send(worker, payout);
    }

    /// @notice Anyone, once the claim window has passed without a settle: escrow returns to the robot.
    ///         Works while paused: it only moves escrow back to the robot's own balance (no MON leaves).
    function expire(uint256 jobId) external {
        Job storage j = _job(jobId);
        if (j.status == Status.Settled) revert AlreadySettled();
        if (j.status != Status.Claimed) revert JobNotClaimed();
        if (block.timestamp <= uint256(j.claimedAt) + j.claimWindow) revert ClaimNotExpired();

        j.status = Status.Expired;
        escrowOf[j.robot] -= j.payout;
        _balances[j.robot] += j.payout;
        emit JobExpired(jobId, j.worker, j.payout);
    }

    /// @notice Robot's agent cancels a job nobody has claimed; escrow returns to the robot.
    ///         Works while paused, like expire.
    function cancel(uint256 jobId) external {
        Job storage j = _job(jobId);
        _onlyAgentOf(j.robot);
        if (j.status != Status.Open) revert JobNotOpen();
        j.status = Status.Cancelled;
        escrowOf[j.robot] -= j.payout;
        _balances[j.robot] += j.payout;
        emit JobCancelled(jobId, j.payout);
    }

    // ---------- views ----------

    function balanceOf(address robot) external view returns (uint256) {
        return _balances[robot];
    }

    function getJob(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    /// @notice Unix time after which a claimed job can be expired (0 if not claimed).
    function claimDeadline(uint256 jobId) external view returns (uint256) {
        Job storage j = _jobs[jobId];
        return j.claimedAt == 0 ? 0 : uint256(j.claimedAt) + j.claimWindow;
    }

    /// @dev Plain transfers would be untracked MON; force callers through fund().
    receive() external payable {
        revert UseFund();
    }
}
