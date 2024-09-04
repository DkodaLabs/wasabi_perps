// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../IWasabiPerps.sol";
import "../addressProvider/IAddressProvider.sol";

interface IWasabiRouter {

    error InvalidSignature();
    error InvalidPool();

    /// @dev Opens a position using the caller's vault deposits
    /// @param _pool The pool to open the position on
    /// @param _request The request to open the position
    /// @param _signature The signature for the request (from ORDER_SIGNER_ROLE)
    function openPosition(
        IWasabiPerps _pool,
        IWasabiPerps.OpenPositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature
    ) external;

    /// @dev Opens a position on behalf of a trader using their vault deposits
    /// @param _pool The pool to open the position on
    /// @param _request The request to open the position
    /// @param _signature The signature for the request (from ORDER_SIGNER_ROLE, validated by the pool)
    /// @param _traderSignature The signature from the trader (derived from request with empty `functionCallDataList`, validated by the router to recover the trader's address)
    /// @param _executionFee The fee to be paid to the router
    function openPosition(
        IWasabiPerps _pool,
        IWasabiPerps.OpenPositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature,
        IWasabiPerps.Signature calldata _traderSignature,
        uint256 _executionFee
    ) external; 

    /// @dev Updates the AddressProvider
    /// @param _addressProvider The new AddressProvider
    function setAddressProvider(IAddressProvider _addressProvider) external;
}