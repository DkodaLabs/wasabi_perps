// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../addressProvider/IAddressProvider.sol";
import "../debt/IDebtController.sol";
import "../router/IWasabiRouter.sol";
import "../util/IPartnerFeeManager.sol";

contract MockAddressProviderV2 is Ownable, IAddressProvider {
    
    IWasabiRouter public wasabiRouter;
    address public feeReceiver;
    address public immutable wethAddress;
    address public liquidationFeeReceiver;
    address public stakingAccountFactory;
    uint256 public liquidationFeeBps; // deprecated
    IPartnerFeeManager public partnerFeeManager;

    constructor(
        IWasabiRouter _wasabiRouter,
        address _feeReceiver,
        address _wethAddress,
        address _liquidationFeeReceiver,
        address _stakingAccountFactory,
        IPartnerFeeManager _partnerFeeManager
    ) Ownable(msg.sender) {
        wasabiRouter = _wasabiRouter;
        feeReceiver = _feeReceiver;
        wethAddress = _wethAddress;
        liquidationFeeReceiver = _liquidationFeeReceiver;
        stakingAccountFactory = _stakingAccountFactory;
        partnerFeeManager = _partnerFeeManager;
    }

    /// @dev sets the fee controller
    /// @param _feeReceiver the fee receiver
    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        feeReceiver = _feeReceiver;
    }

     /// @dev sets the fee controller
    /// @param _liquidationFeeReceiver the fee receiver
    function setLiquidationFeeReceiver(address _liquidationFeeReceiver) external onlyOwner {
        liquidationFeeReceiver = _liquidationFeeReceiver;
    }

    /// @dev sets the staking account factory
    /// @param _stakingAccountFactory the staking account factory
    function setStakingAccountFactory(address _stakingAccountFactory) external onlyOwner {
        stakingAccountFactory = _stakingAccountFactory;
    }
}