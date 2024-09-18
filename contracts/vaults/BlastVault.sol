// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../blast/AbstractBlastContract.sol";
import "./WasabiVault.sol";

contract BlastVault is WasabiVault, AbstractBlastContract {

    /// @dev Initializer for proxy
    /// @notice This function should only be called to initialize a new vault - for upgrading an existing V1 vault use `reinitialize`
    /// @param _longPool The WasabiLongPool contract
    /// @param _shortPool The WasabiShortPool contract
    /// @param _addressProvider The address provider
    /// @param _asset The asset
    /// @param name The name of the vault
    /// @param symbol The symbol of the vault
    function initialize(
        IWasabiPerps _longPool,
        IWasabiPerps _shortPool,
        IAddressProvider _addressProvider,
        IERC20 _asset,
        string memory name,
        string memory symbol
    ) public override reinitializer(2) {
        __AbstractBlastContract_init();
        __Ownable_init(msg.sender);
        __ERC4626_init(_asset);
        __ERC20_init(name, symbol);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        _configurePointsOperator(msg.sender);
        addressProvider = _addressProvider;
        longPool = _longPool;
        shortPool = _shortPool;
    }

    /// @dev claim all gas
    function claimAllGas(address contractAddress, address recipientOfGas) external onlyOwner returns (uint256) {
        return _getBlast().claimAllGas(contractAddress, recipientOfGas);
    }

    /// @dev claims yield
    function claimYield() external onlyOwner {
        address assetAddress = asset();
        if (assetAddress == BlastConstants.WETH || assetAddress == BlastConstants.USDB) {
            IERC20Rebasing token = IERC20Rebasing(assetAddress);
            uint256 claimable = token.getClaimableAmount(address(this));
            if (claimable > 0) {
                uint256 claimed = token.claim(address(this), claimable);
                totalAssetValue += claimed;
                emit NativeYieldClaimed(assetAddress, claimed);
            }
        } else {
            revert CannotClaimNonYieldBearingAsset(assetAddress);
        }
    }
}