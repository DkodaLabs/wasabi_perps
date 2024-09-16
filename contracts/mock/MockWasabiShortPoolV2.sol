// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../WasabiShortPool.sol";

contract MockWasabiShortPoolV2 is WasabiShortPool {

    function addQuoteToken(address _token) external onlyAdmin {
        quoteTokens[_token] = true;
    }
}
