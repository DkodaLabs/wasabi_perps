// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IWasabiPerps} from "./IWasabiPerps.sol";

library PositionUtils {
    /// @dev Computes the close fee for a position by looking at the position size
    /// @param _position the position size
    /// @param _netValue the net value
    /// @param _isLong whether the position is long or short
    function computeCloseFee(
        IWasabiPerps.Position calldata _position,
        uint256 _netValue,
        bool _isLong
    ) internal pure returns(uint256) {
        if (_isLong) {
            return (_position.principal + _netValue) * _position.feesToBePaid / (_position.feesToBePaid + _position.downPayment + _position.principal);
        }
        return (_position.collateralAmount + _netValue) * _position.feesToBePaid / (_position.feesToBePaid + _position.collateralAmount);
    }
}