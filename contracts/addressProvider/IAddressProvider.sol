// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../debt/IDebtController.sol";
import "../fees/IFeeController.sol";

interface IAddressProvider {

    /// @dev Returns the debt controller
    function getDebtController() external view returns (IDebtController);

    /// @dev Returns the fee controller
    function getFeeController() external view returns (IFeeController);

    /// @dev Returns the WETH address
    function getWethAddress() external view returns (address);
}