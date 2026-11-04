// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title MonaidCore v0 — robot balances held in MON, spent only by the robot's agent.
/// @notice Step 1 of Monaid: proves money moves through our own contract. No jobs, claims or signatures yet.
contract MonaidCore {
    // ---------- errors (every revert is a demo beat: keep names short and human) ----------
    error NotOwner();
    error NotAgent();
    error RobotNotRegistered();
    error RobotAlreadyRegistered();
    error ZeroAddress();
    error ZeroAmount();
    error InsufficientBalance(uint256 available, uint256 requested);
    error ContractPaused();
    error TransferFailed();
    error UseFund();

    // ---------- events ----------
    event RobotRegistered(address indexed robot, address indexed agent);
    event Funded(address indexed robot, address indexed from, uint256 amount);
    event Paid(address indexed robot, address indexed to, uint256 amount);
    event Paused(address indexed by);
    event Unpaused(address indexed by);

    // ---------- state ----------
    address public immutable owner;
    bool public paused;

    mapping(address robot => address agent) public agentOf;
    mapping(address robot => uint256) private _balances;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier registered(address robot) {
        if (agentOf[robot] == address(0)) revert RobotNotRegistered();
        _;
    }

    // ---------- owner ----------

    function registerRobot(address robot, address agent) external onlyOwner {
        if (robot == address(0) || agent == address(0)) revert ZeroAddress();
        if (agentOf[robot] != address(0)) revert RobotAlreadyRegistered();
        agentOf[robot] = agent;
        emit RobotRegistered(robot, agent);
    }

    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ---------- money ----------

    /// @notice Anyone can top up a registered robot's balance.
    function fund(address robot) external payable whenNotPaused registered(robot) {
        if (msg.value == 0) revert ZeroAmount();
        _balances[robot] += msg.value;
        emit Funded(robot, msg.sender, msg.value);
    }

    /// @notice The robot's agent pays `amount` MON out of the robot's balance.
    function pay(address robot, address payable to, uint256 amount)
        external
        whenNotPaused
        registered(robot)
    {
        // checks
        if (msg.sender != agentOf[robot]) revert NotAgent();
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        uint256 available = _balances[robot];
        if (amount > available) revert InsufficientBalance(available, amount);
        // effects
        _balances[robot] = available - amount;
        emit Paid(robot, to, amount);
        // interaction
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function balanceOf(address robot) external view returns (uint256) {
        return _balances[robot];
    }

    /// @dev Plain transfers would be untracked MON; force callers through fund().
    receive() external payable {
        revert UseFund();
    }
}
