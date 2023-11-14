// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../WasabiLongPool.sol";

contract MockWasabiLongPoolV2 is WasabiLongPool {
    uint256 public someNewValue;

    function version() pure public returns (string memory) {
        return "v2";
    }

    function setSomeNewValue(uint256 _someNewValue) public onlyOwner {
        someNewValue = _someNewValue;
    }
}