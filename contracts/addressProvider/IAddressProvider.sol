// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../debt/IDebtController.sol";
import "../fees/IFeeController.sol";

interface IAddressProvider {

    /// @notice Returns the debt controller
    function getDebtController() external view returns (IDebtController);

    /// @notice Returns the fee controller
    function getFeeController() external view returns (IFeeController);

    /// @notice Returns the WETH address
    function getWethAddress() external view returns (address);
}