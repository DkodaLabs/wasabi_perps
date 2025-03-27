// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/interfaces/IERC4626.sol";

interface IWasabiVault is IERC4626  {
    error AlreadyMigrated();
    error PrincipalTooHigh();
    error InsufficientAvailablePrincipal();
    error InsufficientPrincipalRepaid();
    error CannotClaimNonYieldBearingAsset(address _asset);
    error EthTransferFailed();
    error CannotDepositEth();
    error CallerNotPool();
    error InvalidEthAmount();
    error InvalidAmount();
    error NoDustToClean();

    event NativeYieldClaimed(
        address token,
        uint256 amount
    );

    event DepositCapUpdated(
        uint256 newDepositCap
    );

    event AdminBorrow(
        address receiver,
        uint256 amount
    );

    event AdminDebtRepaid(
        address debtor,
        uint256 debtRepaid,
        uint256 interestPaid
    );

    /// @dev Deposits ETH into the vault (only WETH vault)
    function depositEth(address receiver) external payable returns (uint256);
    
    /// @dev Returns the long or short pool address
    /// @param _long True for long, false for short
    function getPoolAddress(bool _long) external view returns (address);

    /// @dev Called by the pools to borrow assets when a position is opened
    /// @param _amount The amount of assets to borrow
    function borrow(uint256 _amount) external;

    /// @dev Called by the vault admin to borrow assets for use in strategies
    /// @param _receiver The address to receive the borrowed assets
    /// @param _amount The amount of assets to borrow
    function adminBorrow(address _receiver, uint256 _amount) external;

    /// @dev Called by the pools to repay assets when a position is closed
    /// @param _totalRepaid The amount of assets being repaid
    /// @param _principal The amount original principal borrowed
    /// @param _isLiquidation Flag to indicate if the repayment is due to liquidation and can cause bad debt
    function recordRepayment(uint256 _totalRepaid, uint256 _principal, bool _isLiquidation) external;

    /// @dev Called by the admin to donate assets to the vault, which is recorded as interest
    /// @param _amount The amount of assets to donate
    function donate(uint256 _amount) external;

    /// @dev Called by the admin to remove any leftover assets if `totalSupply` is 0 and `totalAssetValue` is > 0
    function cleanDust() external;

    /// @dev Validates that the leverage is within the maximum allowed by the DebtController
    /// @param _downPayment The down payment amount
    /// @param _total The total value of the position in the same currency as the down payment
    /// @notice For shorts, _total is the collateral amount, for longs it is the down payment + principal
    function checkMaxLeverage(uint256 _downPayment, uint256 _total) external view;

    /// @dev Sets the cap on the amount of assets that can be deposited by all users
    /// @param _newDepositCap The new deposit cap
    function setDepositCap(uint256 _newDepositCap) external;
}