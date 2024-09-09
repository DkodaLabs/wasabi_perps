// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../WasabiShortPool.sol";

contract MockWasabiShortPoolV2 is WasabiShortPool {

    function addBaseToken(address _token) external onlyAdmin {
        baseTokens[_token] = true;
    }
}
