// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IMerkleDistributor {
    function token() external view returns (IERC20);

    function canClaim(address account, uint256 amount, bytes32[] calldata merkleProof) external view returns (bool, uint256);

    function claim(uint256 amount, bytes32[] calldata merkleProof) external;
}