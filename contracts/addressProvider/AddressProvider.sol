// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./IAddressProvider.sol";
import "../debt/IDebtController.sol";

contract AddressProvider is Ownable, IAddressProvider {
    error InvalidAddress();
    error InvalidLiquidationFee();

    IDebtController public debtController;
    address public feeReceiver;
    address public immutable wethAddress;
    address public liquidationFeeReceiver;
    uint256 public liquidationFeeBps;

    constructor(
        IDebtController _debtController,
        address _feeReceiver,
        address _wethAddress,
        address _liquidationFeeReceiver
    ) Ownable(msg.sender) {
        debtController = _debtController;
        feeReceiver = _feeReceiver;
        wethAddress = _wethAddress;
        liquidationFeeReceiver = _liquidationFeeReceiver;
        liquidationFeeBps = 500; // 5%
    }

    /// @inheritdoc IAddressProvider
    function getDebtController()
        external
        view
        override
        returns (IDebtController)
    {
        return debtController;
    }

    /// @inheritdoc IAddressProvider
    function getFeeReceiver()
        external
        view
        override
        returns (address)
    {
        return feeReceiver;
    }

    /// @inheritdoc IAddressProvider
    function getLiquidationFeeReceiver()
        external
        view
        override
        returns (address)
    {
        return liquidationFeeReceiver;
    }

    /// @inheritdoc IAddressProvider
    function getWethAddress() external view returns (address) {
        return wethAddress;
    }

    /// @dev sets the debt controller
    /// @param _debtController the debt controller
    function setDebtController(IDebtController _debtController) external onlyOwner {
        debtController = _debtController;
    }

    /// @dev sets the fee controller
    /// @param _feeReceiver the fee receiver
    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        if (_feeReceiver == address(0)) revert InvalidAddress();
        feeReceiver = _feeReceiver;
    }

    /// @dev sets the fee controller
    /// @param _liquidationFeeReceiver the fee receiver
    function setLiquidationFeeReceiver(address _liquidationFeeReceiver) external onlyOwner {
        if (_liquidationFeeReceiver == address(0)) revert InvalidAddress();
        liquidationFeeReceiver = _liquidationFeeReceiver;
    }

    /// @dev sets the fee controller
    /// @param _liquidationFeeBps the fee receiver
    function setLiquidationFeeBps(uint256 _liquidationFeeBps) external onlyOwner {
        if (_liquidationFeeBps > 500) revert InvalidLiquidationFee();
        liquidationFeeBps = _liquidationFeeBps;
    }

    /// @inheritdoc IAddressProvider
    function getLiquidationFeeBps() external view override returns (uint256) {
        return liquidationFeeBps;
    }
}