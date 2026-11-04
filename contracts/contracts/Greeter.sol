// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// Placeholder contract to verify the Monad deploy pipeline. Replace with the real project contracts.
contract Greeter {
    string public greeting;

    event GreetingChanged(address indexed by, string greeting);

    constructor(string memory _greeting) {
        greeting = _greeting;
    }

    function setGreeting(string calldata _greeting) external {
        greeting = _greeting;
        emit GreetingChanged(msg.sender, _greeting);
    }
}
