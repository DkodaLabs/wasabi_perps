// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./IAddressProvider.sol";
import "../debt/IDebtController.sol";
import "../fees/IFeeController.sol";

contract AddressProvider is Ownable, IAddressProvider {
    IDebtController public debtController;
    IFeeController public feeController;
    address public immutable wethAddress;

    constructor(
        IDebtController _debtController,
        IFeeController _feeController,
        address _wethAddress
    ) Ownable(msg.sender) {
        debtController = _debtController;
        feeController = _feeController;
        wethAddress = _wethAddress;
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
    function getFeeController()
        external
        view
        override
        returns (IFeeController)
    {
        return feeController;
    }

    /// @inheritdoc IAddressProvider
    function getWethAddress() external view returns (address) {
        return wethAddress;
    }

    /// @notice sets the debt controller
    /// @param _debtController the debt controller
    function setDebtController(IDebtController _debtController) external onlyOwner {
        debtController = _debtController;
    }

    /// @notice sets the fee controller
    /// @param _feeController the fee controller
    function setFeeController(IFeeController _feeController) external onlyOwner {
        feeController = _feeController;
    }
}