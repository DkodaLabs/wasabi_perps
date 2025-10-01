// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./BlastConstants.sol";
import "../WasabiLongPool.sol";

contract BlastLongPool is WasabiLongPool {

    /// @dev initializer for proxy
    /// @param _manager the PerpManager contract
    function initialize(PerpManager _manager) public override initializer {
        __WasabiLongPool_init(_manager);
    }

    /// @dev Claims the collateral yield + gas
    function claimCollateralYield() external onlyAdmin {
        address feeReceiver = _getFeeReceiver();
        
        // Claim gas
        _getBlast().claimMaxGas(address(this), feeReceiver);

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

    /// @inheritdoc IWasabiPerps
    function removeCollateral(
        RemoveCollateralRequest calldata,
        Signature calldata
    ) external override payable nonReentrant returns (Position memory) {
        revert InvalidInput();
    }
}