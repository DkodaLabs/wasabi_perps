// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../IWasabiPerps.sol";
import "./IInfraredVault.sol";

interface IStakingAccount {
    error TraderNotAccountHolder();
    error CallerNotFactory();
    error StakingTypeNotSupported();
    
    /// @dev More staking types can be added in the future
    enum StakingType {
        INFRARED
    }

    struct StakingContract {
        address contractAddress;
        StakingType stakingType;
    }

    /// @notice Stakes the collateral of a position in the appropriate staking contract
    /// @param _position The position to stake
    /// @param _stakingContract The staking contract to stake the position in
    function stakePosition(IWasabiPerps.Position memory _position, StakingContract memory _stakingContract) external;

    /// @notice Unstakes the collateral of a position from the appropriate staking contract and sends it to the pool
    /// @param _position The position to unstake
    /// @param _stakingContract The staking contract to unstake the position from
    /// @param _pool The pool to send the collateral to
    function unstakePosition(IWasabiPerps.Position memory _position, StakingContract memory _stakingContract, address _pool) external;

    /// @notice Claims the rewards from the appropriate staking contract
    /// @param _stakingContract The staking contract to claim rewards from
    /// @return tokens The tokens that the rewards are in
    /// @return amounts The amounts of each token that were claimed
    function claimRewards(StakingContract memory _stakingContract) external returns (IERC20[] memory, uint256[] memory);
}
