// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../IWasabiPerps.sol";
import "./IInfraredVault.sol";

interface IStakingAccount {
    error TraderNotAccountHolder();
    error CallerNotFactory();

    /// @notice Stakes the collateral of a position in the Infrared vault
    /// @param _position The position to stake
    function stakePosition(IWasabiPerps.Position memory _position, IInfraredVault _vault) external;

    /// @notice Unstakes the collateral of a position from the Infrared vault and sends it to the pool
    /// @param _position The position to unstake
    /// @param _pool The pool to send the collateral to
    function unstakePosition(IWasabiPerps.Position memory _position, IInfraredVault _vault, address _pool) external;

    /// @notice Claims the rewards from the Infrared vault
    /// @param _vault The vault to claim rewards from
    /// @return tokens The tokens that the rewards are in
    /// @return amounts The amounts of each token that were claimed
    function claimRewards(IInfraredVault _vault) external returns (IERC20[] memory, uint256[] memory);
}
