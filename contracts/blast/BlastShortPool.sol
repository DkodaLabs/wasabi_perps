// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./AbstractBlastContract.sol";
import "../WasabiShortPool.sol";

contract BlastShortPool is WasabiShortPool, AbstractBlastContract {
    /// @dev initializer for proxy
    /// @param _addressProvider address provider contract
    /// @param _manager the PerpManager contract
    function initialize(IAddressProvider _addressProvider, PerpManager _manager) public override initializer {
        __AbstractBlastContract_init();
        __BaseWasabiPool_init(false, _addressProvider, _manager);
        _configurePointsOperator(msg.sender);
    }

    /// @dev claim all gas
    function claimAllGas(address contractAddress, address recipientOfGas) external onlyAdmin returns (uint256) {
        return _getBlast().claimAllGas(contractAddress, recipientOfGas);
    }

    /// @dev claims yield
    function claimYield() external onlyAdmin {
        IERC20Rebasing usdb = IERC20Rebasing(BlastConstants.USDB);
        uint256 claimableUsdb = usdb.getClaimableAmount(address(this));
        if (claimableUsdb > 0) {
            uint256 claimedAmount = usdb.claim(address(this), claimableUsdb);
            IWasabiVault vault = getVault(BlastConstants.USDB);
            vault.recordInterestEarned(claimedAmount);
            emit NativeYieldClaimed(address(vault), BlastConstants.USDB, claimedAmount);
        }
    }

    /// @dev Claims the collateral yield + gas
    function claimCollateralYield() external onlyAdmin {
        // Claim gas and yield
        IBlast blast = _getBlast();
        blast.claimAllGas(address(this), addressProvider.getFeeReceiver());
        blast.claimAllYield(address(this), addressProvider.getFeeReceiver());

        // Claim WETH yield
        IERC20Rebasing weth = IERC20Rebasing(BlastConstants.WETH);
        uint256 claimableWETH = weth.getClaimableAmount(address(this));
        if (claimableWETH > 0) {
            weth.claim(addressProvider.getFeeReceiver(), claimableWETH);
        }
    }
}