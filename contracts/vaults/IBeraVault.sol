// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./IWasabiVault.sol";
import "@berachain/pol-contracts/src/pol/interfaces/IRewardVault.sol";
import "@berachain/pol-contracts/src/pol/interfaces/IRewardVaultFactory.sol";

interface IBeraVault is IWasabiVault {
    error InvalidFeeBips();
    error TransferNotSupported();

    event RewardFeeBipsUpdated(uint256 oldFeeBips, uint256 newFeeBips);

    /// @notice Get the POL RewardVault contract where spicy tokens are staked
    function rewardVault() external view returns (IRewardVault);

    /// @notice Get the POL RewardVaultFactory contract used to create the RewardVault
    function REWARD_VAULT_FACTORY() external view returns (IRewardVaultFactory);

    /// @notice Get the fee charged on BGT rewards
    function rewardFeeBips() external view returns (uint256);
    
    /// @notice Claim the BGT rewards accrued to the vault
    /// @param _receiver The address to receive the BGT rewards
    /// @return The amount of BGT claimed
    function claimBGTReward(address _receiver) external returns (uint256);

    /// @notice Set the fee charged on BGT rewards
    /// @param _rewardFeeBips The fee charged on BGT rewards in basis points
    function setRewardFeeBips(uint256 _rewardFeeBips) external;

    /// @notice Migrate fee portion from pre-existing deposits
    /// @param accounts The accounts to migrate fees for
    function migrateFees(address[] calldata accounts) external;
}