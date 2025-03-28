// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./IWasabiVault.sol";
import "@berachain/pol-contracts/src/pol/interfaces/IRewardVault.sol";
import "@berachain/pol-contracts/src/pol/interfaces/IRewardVaultFactory.sol";

interface IBeraVault is IWasabiVault {
    error InvalidFeeBips();
    error TransferNotSupported();
    error AllBalancesNotMigrated();

    event RewardFeeBipsUpdated(uint256 oldFeeBips, uint256 newFeeBips);

    /// @notice Get the POL RewardVault contract where spicy tokens are staked
    function getRewardVault() external view returns (IRewardVault);

    /// @notice Get the POL RewardVaultFactory contract used to create the RewardVault
    function REWARD_VAULT_FACTORY() external view returns (IRewardVaultFactory);

    /// @notice Get the fee charged on BGT rewards
    function getRewardFeeBips() external view returns (uint256);

    /// @notice Set the fee charged on BGT rewards
    /// @param _rewardFeeBips The fee charged on BGT rewards in basis points
    function setRewardFeeBips(uint256 _rewardFeeBips) external;
    
    /// @notice Claim the BGT rewards accrued to the vault
    /// @param _receiver The address to receive the BGT rewards
    /// @return The amount of BGT claimed
    function claimBGTReward(address _receiver) external returns (uint256);

    /// @notice Migrate fee portion from pre-existing deposits
    /// @param accounts The accounts to migrate fees for
    /// @param isAllBalances If true, revert if the balances of the accounts do not sum to the total supply
    /// @param _newFeeBips The new fee to apply to the accounts
    function migrateFees(address[] calldata accounts, bool isAllBalances, uint256 _newFeeBips) external;
}