// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./BlastConstants.sol";
import "../WasabiShortPool.sol";

contract BlastShortPool is WasabiShortPool {
    /// @dev initializer for proxy
    /// @param _manager the PerpManager contract
    function initialize(PerpManager _manager) public override initializer {
        __WasabiShortPool_init(_manager);
    }

    /// @dev Claims the collateral yield + gas
    function claimCollateralYield() external onlyAdmin {
        address feeReceiver = _getFeeReceiver();

        // Claim gas and yield
        IBlast blast = _getBlast();
        blast.claimMaxGas(address(this), feeReceiver);
        blast.claimAllYield(address(this), feeReceiver);

        // Claim WETH yield
        IERC20Rebasing weth = IERC20Rebasing(BlastConstants.WETH);
        uint256 claimable = weth.getClaimableAmount(address(this));
        if (claimable > 0) {
            weth.claim(feeReceiver, claimable);
        }

        // Claim USDB yield
        IERC20Rebasing usdb = IERC20Rebasing(BlastConstants.USDB);
        claimable = usdb.getClaimableAmount(address(this));
        if (claimable > 0) {
            usdb.claim(feeReceiver, claimable);
        }
    }

    /// @dev returns the address of the Blast contract
    function _getBlast() internal pure returns (IBlast) {
        return IBlast(BlastConstants.BLAST);
    }
}