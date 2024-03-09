// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./IBlast.sol";
import "./BlastConstants.sol";

/// @title AbstractBlastContract
/// @notice An abstract contract that can configure/claim Blast points/yield
abstract contract AbstractBlastContract {
    /// @dev initializer for proxy
    function __AbstractBlastContract_init() internal {
        IBlast blast = _getBlast();
        blast.configureClaimableYield();
        blast.configureClaimableGas();

        IERC20Rebasing(BlastConstants.USDB).configure(YieldMode.CLAIMABLE);
        IERC20Rebasing(BlastConstants.WETH).configure(YieldMode.CLAIMABLE);
    }

    /// @dev configure the points operator
    function _configurePointsOperator(address _operator) internal {
        IBlastPoints(BlastConstants.BLAST_POINTS).configurePointsOperator(_operator);
    }

    /// @dev returns the address of the Blast contract
    function _getBlast() internal pure returns (IBlast) {
        return IBlast(BlastConstants.BLAST);
    }
}