// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// @notice Very simplified interface for Balancer V2 style weighted pools
interface IWeightedPool {
    function getNormalizedWeights() external view returns (uint256[] memory);
}