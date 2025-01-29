// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../debt/IDebtController.sol";
import "../vaults/IWasabiVault.sol";
import "../router/IWasabiRouter.sol";

interface IAddressProvider {

    /// @dev Returns the debt controller
    function getDebtController() external view returns (IDebtController);

    /// @dev Returns the Wasabi router
    function getWasabiRouter() external view returns (IWasabiRouter);

    /// @dev Returns the fee receiver address
    function getFeeReceiver() external view returns (address);

    /// @dev Returns the WETH address
    function getWethAddress() external view returns (address);

     /// @dev Returns the fee receiver address
    function getLiquidationFeeReceiver() external view returns (address);

    /// @dev Returns the liquidation fee bps
    function getLiquidationFeeBps() external view returns (uint256);

    /// @dev Returns the liquidation fee for a given down payment
    function getLiquidationFee(uint256 _downPayment) external view returns (uint256);
}