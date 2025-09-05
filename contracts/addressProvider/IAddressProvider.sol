// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../vaults/IWasabiVault.sol";
import "../router/IWasabiRouter.sol";
import "../util/IPartnerFeeManager.sol";

interface IAddressProvider {
    error InvalidAddress();
    error InvalidLiquidationFee();

    /// @dev Returns the Wasabi router
    function wasabiRouter() external view returns (IWasabiRouter);

    /// @dev Returns the fee receiver address
    function feeReceiver() external view returns (address);

    /// @dev Returns the WETH address
    function wethAddress() external view returns (address);

     /// @dev Returns the fee receiver address
    function liquidationFeeReceiver() external view returns (address);

    /// @dev Returns the staking account factory address
    function stakingAccountFactory() external view returns (address);

    /// @dev Returns the partner fee manager
    function partnerFeeManager() external view returns (IPartnerFeeManager);

    /// @dev sets the Wasabi router
    /// @param _wasabiRouter the Wasabi router
    function setWasabiRouter(IWasabiRouter _wasabiRouter) external;

    /// @dev sets the fee receiver
    /// @param _feeReceiver the fee receiver
    function setFeeReceiver(address _feeReceiver) external;

    /// @dev sets the liquidation fee receiver
    /// @param _liquidationFeeReceiver the fee receiver
    function setLiquidationFeeReceiver(address _liquidationFeeReceiver) external;

    /// @dev sets the staking account factory
    /// @param _stakingAccountFactory the staking account factory
    function setStakingAccountFactory(address _stakingAccountFactory) external;

    /// @dev sets the partner fee manager
    /// @param _partnerFeeManager the partner fee manager
    function setPartnerFeeManager(address _partnerFeeManager) external;
}