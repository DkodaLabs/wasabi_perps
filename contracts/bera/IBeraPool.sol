// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../IWasabiPerps.sol";

interface IBeraPool is IWasabiPerps {
    error PositionAlreadyStaked(uint256 _positionId);
    error CallerNotTrader();

    /// @notice Opens a position and stakes the collateral
    /// @param _request the request to open a position
    /// @param _signature the signature of the request
    function openPositionAndStake(
        OpenPositionRequest calldata _request, 
        Signature calldata _signature
    ) external payable returns (Position memory);

    /// @dev Opens a position on behalf of a user and stakes the collateral
    /// @param _request the request to open a position
    /// @param _signature the signature of the request
    /// @param _trader the address of the user for whom the position is opened
    function openPositionAndStakeFor(
        OpenPositionRequest calldata _request,
        Signature calldata _signature,
        address _trader
    ) external payable returns (Position memory);
}
