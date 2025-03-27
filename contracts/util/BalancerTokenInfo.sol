// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../admin/PerpManager.sol";
import "./IBalancerVault.sol";
import "./IWeightedPool.sol";

contract BalancerTokenInfo is UUPSUpgradeable, OwnableUpgradeable {
    IBalancerVault public vault;

    struct PoolTokenInfo {
        address[] tokens;
        uint256[] balances;
        uint256[] weights;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        IBalancerVault _vault
    ) external initializer {
        __Ownable_init(msg.sender);
        vault = _vault;
    }

    function getPoolBalancesAndWeights(bytes32 poolId) external view returns (
        PoolTokenInfo memory poolTokenInfo
    ) {
        (address pool, ) = vault.getPool(poolId);
        (poolTokenInfo.tokens, poolTokenInfo.balances, ) = vault.getPoolTokens(poolId);
        poolTokenInfo.weights = IWeightedPool(pool).getNormalizedWeights();
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal override onlyOwner {}
}