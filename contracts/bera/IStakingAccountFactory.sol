// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../IWasabiPerps.sol";
import "./IStakingAccount.sol";

interface IStakingAccountFactory {
    error CallerNotPool();
    error VaultNotSetForToken(address _token);

    event StakingAccountCreated(address indexed user, address stakingAccount);
    event StakedPosition(address indexed user, address stakingAccount, uint256 positionId, uint256 collateralAmount);
    event UnstakedPosition(address indexed user, address stakingAccount, uint256 positionId, uint256 collateralAmount);
    event StakingRewardsClaimed(address indexed user, address stakingAccount, address rewardToken, uint256 amount);

    /// @notice Stakes the collateral of a position in the Infrared vault via the trader's StakingAccount
    /// @param _position The position to stake
    function stakePosition(IWasabiPerps.Position memory _position) external;

    /// @notice Unstakes the collateral of a position, sends it to the pool via the StakingAccount, and claims rewards
    /// @param _position The position to unstake
    function unstakePosition(IWasabiPerps.Position memory _position) external;

    /// @notice Claims the rewards from the Infrared vault
    /// @param _stakingToken The staking token to claim rewards for
    function claimRewards(address _stakingToken) external;

    /// @notice Returns the StakingAccount for a trader
    /// @param _user The trader to get the StakingAccount for
    function getOrCreateStakingAccount(address _user) external returns (IStakingAccount);

    /// @notice Sets the vault for a staking token
    /// @param _stakingToken The staking token to set the vault for
    /// @param _vault The vault to set
    function setVaultForStakingToken(address _stakingToken, address _vault) external;

    /// @notice Upgrades the StakingAccount proxies to a new implementation
    /// @param _newImplementation The new implementation to upgrade to
    function upgradeBeacon(address _newImplementation) external;
}
