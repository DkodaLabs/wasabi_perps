// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./AbstractBlastContract.sol";
import "../WasabiLongPoolV1.sol";

contract BlastLongPoolV1 is WasabiLongPoolV1, AbstractBlastContract {

    /// @dev initializer for proxy
    /// @param _addressProvider address provider contract
    /// @param _manager the PerpManager contract
    function initialize(IAddressProvider _addressProvider, PerpManager _manager) public override initializer {
        __AbstractBlastContract_init();
        __BaseWasabiPool_init(true, _addressProvider, _manager); 
        _configurePointsOperator(msg.sender);
    }

    /// @dev claims yield
    function claimYield() external onlyAdmin {
        IBlast blast = _getBlast();
        uint256 claimedEth = blast.claimAllYield(address(this), address(this));
        IWETHRebasing weth = IWETHRebasing(BlastConstants.WETH);
        if (claimedEth > 0) {
            weth.deposit{value: claimedEth}();
        }
        
        uint256 claimableWeth = weth.getClaimableAmount(address(this));
        if (claimableWeth > 0) {
            claimedEth += weth.claim(address(this), claimableWeth);
        }

        if (claimedEth > 0) {
            IWasabiVault vault = getVault(BlastConstants.WETH);
            vault.recordInterestEarned(claimedEth);
            emit NativeYieldClaimed(address(vault), BlastConstants.WETH, claimedEth);
        }
    }

    /// @dev Claims the collateral yield + gas
    function claimCollateralYield() external onlyAdmin {
        // Claim gas
        IBlast blast = _getBlast();
        blast.claimAllGas(address(this), addressProvider.getFeeReceiver());

        // Claim USDB yield
        IERC20Rebasing usdb = IERC20Rebasing(BlastConstants.USDB);
        uint256 claimableUsdb = usdb.getClaimableAmount(address(this));
        if (claimableUsdb > 0) {
            usdb.claim(addressProvider.getFeeReceiver(), claimableUsdb);
        }
    }
}