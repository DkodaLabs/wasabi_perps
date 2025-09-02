// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../blast/AbstractBlastContract.sol";
import "../admin/PerpManager.sol";

contract BlastPerpManager is PerpManager, AbstractBlastContract {

    /// @dev initializer for proxy
    function initialize(
        IWasabiRouter _wasabiRouter,
        address _feeReceiver,
        address _wethAddress,
        address _liquidationFeeReceiver,
        address _stakingAccountFactory,
        IPartnerFeeManager _partnerFeeManager,
        uint256 _maxApy,
        uint256 _maxLeverage
    ) public override initializer {
        __AccessManager_init(msg.sender);
        __AbstractBlastContract_init();
        __PerpManager_init(_wasabiRouter, _feeReceiver, _wethAddress, _liquidationFeeReceiver, _stakingAccountFactory, _partnerFeeManager, _maxApy, _maxLeverage);
    }
}