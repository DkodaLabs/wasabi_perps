// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../vaults/IWasabiVault.sol";
import "../router/IWasabiRouter.sol";
import "../util/IPartnerFeeManager.sol";

interface IAddressProvider {
    error InvalidAddress();
    error InvalidLiquidationFee();

    /// @dev Returns the Wasabi router
    function getWasabiRouter() external view returns (IWasabiRouter);

    /// @dev Returns the fee receiver address
    function getFeeReceiver() external view returns (address);

    /// @dev Returns the WETH address
    function getWethAddress() external view returns (address);

     /// @dev Returns the fee receiver address
    function getLiquidationFeeReceiver() external view returns (address);

    /// @dev Returns the staking account factory address
    function getStakingAccountFactory() external view returns (address);

    /// @dev Returns the partner fee manager
    function getPartnerFeeManager() external view returns (IPartnerFeeManager);
}