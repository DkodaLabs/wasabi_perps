// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "../vaults/BeraVault.sol";

contract MockBeraVault is BeraVault {
    function initializeWithFactory(
        IWasabiPerps _longPool,
        IWasabiPerps _shortPool,
        IAddressProvider _addressProvider,
        PerpManager _manager,
        IERC20 _asset,
        string memory name,
        string memory symbol,
        IRewardVaultFactory _rewardVaultFactory
    ) public initializer {
        __Ownable_init(address(_manager));
        __ERC4626_init(_asset);
        __ERC20_init(name, symbol);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        addressProvider = _addressProvider;
        longPool = _longPool;
        shortPool = _shortPool;

        RewardStorage storage rs = _getRewardStorage();
        rs.rewardVault = IRewardVault(_rewardVaultFactory.createRewardVault(address(this)));
        rs.rewardFeeBips = 1000; // 10%

        _approve(address(this), address(rs.rewardVault), type(uint256).max);
    }
}