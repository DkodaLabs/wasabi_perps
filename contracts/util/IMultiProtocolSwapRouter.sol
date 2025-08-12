// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMultiProtocolSwapRouter {
    error InvalidProtocol();

    enum Protocol {
        UNISWAP_V2,
        UNISWAP_V3,
        PANCAKE_V2,
        PANCAKE_V3,
        AERODROME,
        AERODROME_SLIPSTREAM
    }

    function executeSwap(Protocol _protocol, bytes calldata _swapData) external payable;

    function setRouter(Protocol _protocol, address _router) external;
}