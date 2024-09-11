// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./IWasabiVault.sol";

interface IWasabiVaultV2 is IWasabiVault {
    error Deprecated();
    error PrincipalTooHigh();
    error InsufficientAvailablePrincipal();
    
    /// @dev Returns the long or short pool address
    /// @param _long True for long, false for short
    function getPoolAddress(bool _long) external view returns (address);

    /// @dev Returns the long and short pool addresses
    function getPoolAddresses() external view returns (address, address);

    /// @dev Called by the pools to borrow assets when a position is opened
    /// @param _amount The amount of assets to borrow
    function borrow(uint256 _amount) external;

    /// @dev Called by the pools to repay assets when a position is closed
    /// @param _amount The amount of assets to repay
    /// @param _interestEarned The amount of interest earned, if any
    /// @param _loss The amount of loss, if any
    function repay(uint256 _amount, uint256 _interestEarned, uint256 _loss) external;

    /// @dev Called by the admin to donate assets to the vault, which is recorded as interest
    /// @param _amount The amount of assets to donate
    function donate(uint256 _amount) external;

    /// @dev Validates that the leverage is within the maximum allowed by the DebtController
    /// @param _downPayment The down payment amount
    /// @param _total The total value of the position in the same currency as the down payment
    /// @notice For shorts, _total is the collateral amount, for longs it is the down payment + principal
    function checkMaxLeverage(uint256 _downPayment, uint256 _total) external view;
}