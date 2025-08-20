// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./MockAToken.sol";
import "../strategy/IAavePool.sol";

contract MockAavePool is IAavePool {
    using SafeERC20 for IERC20;

    MockAToken public aToken;

    constructor(address _aToken) {
        aToken = MockAToken(_aToken);
    }

    function getReserveAToken(address) external view returns (address) {
        return address(aToken);
    }

    function supply(address asset, uint256 amount, address onBehalfOf, uint16) external {
        aToken.mint(onBehalfOf, amount);
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        aToken.burn(msg.sender, amount);
        IERC20(asset).safeTransfer(to, amount);
        return amount;
    }
}
