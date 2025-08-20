// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IAavePool {
    function getReserveAToken(address asset) external view returns (address);

    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;

    function withdraw(address asset, uint256 amount, address to) external returns (uint256);
}
