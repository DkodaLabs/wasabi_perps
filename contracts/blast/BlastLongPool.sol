// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./AbstractBlastContract.sol";
import "../WasabiLongPool.sol";

contract BlastLongPool is WasabiLongPool, AbstractBlastContract {

    /// @dev initializer for proxy
    /// @param _addressProvider address provider contract
    /// @param _manager the PerpManager contract
    function initialize(IAddressProvider _addressProvider, PerpManager _manager) public override initializer {
        __AbstractBlastContract_init();
        __BaseWasabiPool_init(true, _addressProvider, _manager); 
        _configurePointsOperator(msg.sender);
    }

    /// @dev claim all gas
    function claimAllGas(address contractAddress, address recipientOfGas) external onlyAdmin returns (uint256) {
        return _getBlast().claimAllGas(contractAddress, recipientOfGas);
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
}