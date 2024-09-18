// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../vaults/WasabiVaultV1.sol";

contract MaliciousVault is WasabiVaultV1 {

    function drainPool() external {
        uint256 balance = IERC20(asset()).balanceOf(address(pool));
        pool.withdraw(asset(), balance, msg.sender);
    }
}