// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// @notice Very simplified interface for Balancer V2 style vault contract
interface IBalancerVault {
    function getPool(bytes32 poolId) external view returns (address, uint8);

    function getPoolTokens(bytes32 poolId) external view returns (address[] memory, uint256[] memory, uint256);
}