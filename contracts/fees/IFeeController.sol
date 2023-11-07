// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IFeeController {
    /// @notice returns the fee receiver
    /// @return feeReceiver the fee receiver
    function getFeeReceiver() external view returns (address feeReceiver);

    /// @notice Computes the fee amount
    /// @param amount the amount to compute the fee for
    /// @return feeAmount the fee amount
    function computeTradeFee(uint256 amount) external view returns (uint256 feeAmount);

    /// @notice Computes the fee amount
    /// @param amount the amount to compute the fee for
    /// @return feeAmount the fee amount
    function computeTradeAndSwapFee(uint256 amount) external view returns (uint256 feeAmount);
}