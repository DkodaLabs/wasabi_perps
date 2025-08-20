// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IAavePool.sol";
import "../IStrategy.sol";
import "../../admin/PerpManager.sol";
import "../../vaults/WasabiVault.sol";

contract AaveStrategy is IStrategy, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    address public vault;
    address public asset;
    address public collateralAsset;
    address public aavePool;

    /// @dev Checks if the caller is an admin
    modifier onlyAdmin() {
        _getManager().isAdmin(msg.sender);
        _;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert OnlyVault();
        _;
    }

    function initialize(address _vault, address _aavePool, address _manager) external initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(_manager);
        __ReentrancyGuard_init();

        vault = _vault;
        asset = IWasabiVault(_vault).asset();
        aavePool = _aavePool;
        collateralAsset = IAavePool(aavePool).getReserveAToken(asset);
    }

    function deposit(uint256 amount) external onlyVault returns (address collateral, uint256 collateralIncreased) {
        // Vault has already transferred the asset to this contract
        // Get the current collateral balance of the strategy
        uint256 balanceBefore = IERC20(collateralAsset).balanceOf(address(this));
        // Grant allowance to the Aave pool
        IERC20(asset).safeIncreaseAllowance(aavePool, amount);
        // Call the Aave pool to supply the asset
        IAavePool(aavePool).supply(asset, amount, address(this), 0);
        // Get the collateral amount received
        collateral = collateralAsset;
        collateralIncreased = IERC20(collateral).balanceOf(address(this)) - balanceBefore;
    }

    function withdraw(uint256 amount) external onlyVault returns (address collateral, uint256 collateralSold) {
        // Withdraw the asset from the Aave pool and have it sent directly to the vault
        collateral = collateralAsset;
        collateralSold = IAavePool(aavePool).withdraw(asset, amount, vault);
    }

    function getNewInterest(uint256 lastObservedAmount) external view returns (uint256 interestReceived) {
        // Get the interest earned since the last observed amount
        uint256 currentBalance = IERC20(collateralAsset).balanceOf(address(this));
        if (currentBalance >= lastObservedAmount) {
            interestReceived = currentBalance - lastObservedAmount;
        } else {
            interestReceived = 0;
        }
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal override onlyAdmin {}

    /// @dev returns the manager of the contract
    function _getManager() internal view returns (PerpManager) {
        return PerpManager(owner());
    }
}