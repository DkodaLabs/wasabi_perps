// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IDebtController {
    /// @notice Computes the maximum debt
    /// @param _collateralToken the collateral token address
    /// @param _principalToken the principal token address
    /// @param _principal the principal borrowed
    /// @param _lastFundingTimestamp the timestamp where the loan was last funded
    /// @return maxDebt the maximum debt amount to close the loan
    function computeMaxDebt(
        address _collateralToken,
        address _principalToken,
        uint256 _principal,
        uint256 _lastFundingTimestamp
    ) external view returns(uint256 maxDebt);

    /// @notice Computes the maximum principal
    /// @param _collateralToken the collateral token address
    /// @param _principalToken the principal token address
    /// @param _downPayment the down payment the trader is paying
    /// @return maxPrincipal the maximum principal allowed to be borrowed
    function computeMaxPrincipal(
        address _collateralToken,
        address _principalToken,
        uint256 _downPayment
    ) external view returns (uint256 maxPrincipal);
}