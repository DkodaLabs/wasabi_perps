// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../IWasabiPerps.sol";

interface IBeraPool is IWasabiPerps {
    error PositionAlreadyStaked(uint256 _positionId); // 0x481b8819
    error CannotPartiallyStakePosition(); // 0xf1c80067

    /// @notice Stakes a position
    /// @param _position the position to stake
    function stakePosition(Position memory _position) external;

    /// @notice Returns true if the position is staked
    /// @param _positionId the id of the position
    /// @return true if the position is staked, false otherwise
    function isPositionStaked(uint256 _positionId) external view returns (bool);
}
