// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../blast/AbstractBlastContract.sol";
import "./WasabiVaultV2.sol";

contract BlastVaultV2 is WasabiVaultV2, AbstractBlastContract {

    /// @dev claim all gas
    function claimAllGas(address contractAddress, address recipientOfGas) external onlyOwner returns (uint256) {
        return _getBlast().claimAllGas(contractAddress, recipientOfGas);
    }

    /// @dev claims yield
    function claimYield() external onlyOwner {
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
            totalAssetValue += claimedEth;
        }
    }

    /// @dev Claims the collateral yield + gas
    function claimCollateralYield() external onlyOwner {
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