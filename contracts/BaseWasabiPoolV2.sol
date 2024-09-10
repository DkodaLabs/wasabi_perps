// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./BaseWasabiPool.sol";
import "./vaults/IWasabiVaultV2.sol";

abstract contract BaseWasabiPoolV2 is BaseWasabiPool {
    using SafeERC20 for IERC20;

    error Deprecated();

    /// @inheritdoc IWasabiPerps
    /// @notice Deprecated
    function withdraw(address, uint256, address) external pure override {
        revert Deprecated();
    }

    /// @inheritdoc IWasabiPerps
    /// @notice Deprecated
    function donate(address, uint256) external pure override {
        revert Deprecated();
    }

    /// @dev Same as `getVault` but returns the vault as `IWasabiVaultV2` instead
    /// @param _asset The asset address
    function getVaultV2(address _asset) public view returns (IWasabiVaultV2) {
        if (_asset == address(0)) {
            _asset = _getWethAddress();
        }
        if (vaults[_asset] == address(0)) revert InvalidVault();
        return IWasabiVaultV2(vaults[_asset]);
    }

    /// @inheritdoc IWasabiPerps
    function addVault(IWasabiVault _vault) external override onlyAdmin {
        IWasabiVaultV2 vault = IWasabiVaultV2(address(_vault));
        if (vault.getPoolAddress(isLongPool) != address(this)) revert InvalidVault();
        // Only long pool can have ETH vault
        address asset = vault.asset();
        if (asset == _getWethAddress() && !isLongPool) revert InvalidVault();
        if (vaults[asset] != address(0)) revert VaultAlreadyExists();
        vaults[asset] = address(vault);
        emit NewVault(address(this), asset, address(vault));
    }

    /// @inheritdoc BaseWasabiPool
    /// @notice This function now also handles the actual repayment to the V2 vault
    function _recordRepayment(
        uint256 _principal,
        address _principalCurrency,
        bool _isLiquidation,
        uint256 _principalRepaid,
        uint256 _interestPaid
    ) internal override {
        IWasabiVaultV2 vault = getVaultV2(_principalCurrency);
        uint256 totalRepayment = _principalRepaid + _interestPaid;
        if (IERC20(_principalCurrency).allowance(address(this), address(vault)) < totalRepayment) {
            IERC20(_principalCurrency).forceApprove(address(vault), type(uint256).max);
        }
        if (_principalRepaid < _principal) {
            // Only liquidations can cause bad debt
            if (!_isLiquidation) revert InsufficientPrincipalRepaid();
            vault.repay(totalRepayment, 0, _principal - _principalRepaid);
        } else {
            vault.repay(totalRepayment, _interestPaid, 0);
        }
    }
}