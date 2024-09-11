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
        address assetAddress = asset();
        if (assetAddress == BlastConstants.WETH || assetAddress == BlastConstants.USDB) {
            _claimYield(assetAddress);
        } else {
            revert CannotClaimNonYieldBearingAsset(assetAddress);
        }
    }

    function _claimYield(address _asset) internal {
        IERC20Rebasing token = IERC20Rebasing(_asset);
        uint256 claimable = token.getClaimableAmount(address(this));
        if (claimable > 0) {
            uint256 claimed = token.claim(address(this), claimable);
            totalAssetValue += claimed;
            emit NativeYieldClaimed(_asset, claimed);
        }
    }
}