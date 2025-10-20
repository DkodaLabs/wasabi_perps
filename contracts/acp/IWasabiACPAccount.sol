// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../IWasabiPerps.sol";
import "../vaults/IWasabiVault.sol";

interface IWasabiACPAccount {
    error CallerNotOwnerOrAgent();
    error InvalidAmount();

    /// @notice Withdraws funds from the account
    /// @param _token The token to withdraw
    /// @param _amount The amount to withdraw
    function withdrawFunds(
        address _token,
        uint256 _amount
    ) external;

    /// @notice Opens a position
    /// @dev Assumes that the payment amount is already transferred to the account
    /// @param _pool The pool to open the position on
    /// @param _request The request to open a position
    /// @param _signature The signature of the request
    function openPosition(
        IWasabiPerps _pool,
        IWasabiPerps.OpenPositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature
    ) external;

    /// @notice Closes a position
    /// @dev Sends the payout to the owner of the account
    /// @param _pool The pool to close the position on
    /// @param _payoutType The payout type to use
    /// @param _request The request to close a position
    /// @param _signature The signature of the request
    function closePosition(
        IWasabiPerps _pool,
        IWasabiPerps.PayoutType _payoutType,
        IWasabiPerps.ClosePositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature
    ) external;

    /// @notice Deposits funds to a vault
    /// @dev Assumes that the amount is already transferred to the account
    /// @param _vault The vault to deposit to
    /// @param _amount The amount to deposit
    function depositToVault(
        IWasabiVault _vault,
        uint256 _amount
    ) external;

    /// @notice Withdraws funds from a vault
    /// @dev Sends the withdrawn funds to the owner of the account
    /// @param _vault The vault to withdraw from
    /// @param _amount The amount to withdraw
    function withdrawFromVault(
        IWasabiVault _vault,
        uint256 _amount
    ) external;
}