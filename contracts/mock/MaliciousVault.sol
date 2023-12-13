// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../vaults/WasabiVault.sol";

contract MaliciousVault is WasabiVault {

    function drainPool() external {
        uint256 balance = IERC20(asset()).balanceOf(address(pool));
        pool.withdraw(asset(), balance, msg.sender);
    }
}