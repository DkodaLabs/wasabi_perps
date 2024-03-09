// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../blast/AbstractBlastContract.sol";
import "./WasabiVault.sol";

contract BlastWasabiVault is WasabiVault, AbstractBlastContract {

    /// @dev Initializer for proxy
    /// @param _pool The WasabiPerps pool
    /// @param _addressProvider The address provider
    /// @param _asset The asset
    /// @param name The name of the vault
    /// @param symbol The symbol of the vault
    function initialize(
        IWasabiPerps _pool,
        IAddressProvider _addressProvider,
        IERC20 _asset,
        string memory name,
        string memory symbol
    ) public override initializer {
        __AbstractBlastContract_init();
        __Ownable_init(msg.sender);
        __ERC4626_init(_asset);
        __ERC20_init(name, symbol);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        _configurePointsOperator(msg.sender);
        pool = _pool;
        addressProvider = _addressProvider;
        totalAssetValue = 0;
    }

    /// @dev claim all gas
    function claimAllGas(address contractAddress, address recipientOfGas) external onlyOwner returns (uint256) {
        return _getBlast().claimAllGas(contractAddress, recipientOfGas);
    }
}