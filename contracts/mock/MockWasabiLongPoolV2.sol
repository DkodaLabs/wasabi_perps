// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../WasabiLongPool.sol";

contract MockWasabiLongPoolV2 is WasabiLongPool {
    uint256 public someNewValue;

    function setSomeNewValue(uint256 _someNewValue) external onlyOwner {
        someNewValue = _someNewValue;
    }
}