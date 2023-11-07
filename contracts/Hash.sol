// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IWasabiPerps} from "./IWasabiPerps.sol";

library Hash {
    bytes32 private constant _FUNCTION_CALL_DATA_HASH =
        keccak256("FunctionCallData(address to,uint256 value,bytes data)");
    bytes32 private constant _OPEN_POSITION_REQUEST_HASH =
        keccak256("OpenPositionRequest(uint256 id,address currency,address targetCurrency,uint256 downPayment,uint256 principal,uint256 minTargetAmount,uint256 expiration,uint256 swapPrice,uint256 swapPriceDenominator,FunctionCallData[] functionCallDataList)FunctionCallData(address to,uint256 value,bytes data)");
    bytes32 private constant _POSITION_HASH =
        keccak256("Position(uint128 id,uint128 lastFundingTimestamp,address trader,address currency,address collateralCurrency,uint256 downPayment,uint256 principal,uint256 collateralAmount)");
    bytes32 private constant _CLOSE_POSITION_REQUEST_HASH =
        keccak256("ClosePositionRequest(Position position,FunctionCallData[] functionCallDataList)Position(uint128 id,uint128 lastFundingTimestamp,address trader,address currency,address collateralCurrency,uint256 downPayment,uint256 principal,uint256 collateralAmount)FunctionCallData(address to,uint256 value,bytes data)");

    /// @notice hashes the given FunctionCallData list
    /// @param functionCallDataList The list of function call data to hash
    function getFunctionCallDataListHash(IWasabiPerps.FunctionCallData[] memory functionCallDataList) internal pure returns (bytes32) {
        bytes32[] memory functionCallDataHashes = new bytes32[](functionCallDataList.length);
        for (uint256 i = 0; i < functionCallDataList.length; i++) {
            functionCallDataHashes[i] = keccak256(
                abi.encode(
                    _FUNCTION_CALL_DATA_HASH,
                    functionCallDataList[i].to,
                    functionCallDataList[i].value,
                    keccak256(functionCallDataList[i].data)
                )
            );
        }

        return keccak256(abi.encodePacked(functionCallDataHashes));
    }

    /// @notice Hashes the given OpenPositionRequest
    /// @param _request The request to hash
    function hash(IWasabiPerps.OpenPositionRequest calldata _request) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            _OPEN_POSITION_REQUEST_HASH,
            _request.id,
            _request.currency,
            _request.targetCurrency,
            _request.downPayment,
            _request.principal,
            _request.minTargetAmount,
            _request.expiration,
            _request.swapPrice,
            _request.swapPriceDenominator,
            getFunctionCallDataListHash(_request.functionCallDataList)
        ));
    }

    /// @notice Hashes the given ClosePositionRequest
    /// @param _request The request to hash
    function hash(IWasabiPerps.ClosePositionRequest calldata _request) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            _CLOSE_POSITION_REQUEST_HASH,
            hash(_request.position),
            getFunctionCallDataListHash(_request.functionCallDataList)
        ));
    }

    /// @notice Hashes the given Position
    /// @param _position the position
    function hash(IWasabiPerps.Position memory _position) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            _OPEN_POSITION_REQUEST_HASH,
            _position.id,
            _position.lastFundingTimestamp,
            _position.trader,
            _position.currency,
            _position.collateralCurrency,
            _position.downPayment,
            _position.principal,
            _position.collateralAmount
        ));
    }
}