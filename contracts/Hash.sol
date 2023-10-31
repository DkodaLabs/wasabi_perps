// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IWasabiPerps} from "./IWasabiPerps.sol";

library Hash {
    bytes32 private constant _FUNCTION_CALL_DATA_HASH =
        keccak256("FunctionCallData(address to,uint256 value,bytes data)");
    bytes32 private constant _OPEN_POSITION_REQUEST_HASH =
        keccak256("OpenPositionRequest(uint128 id,address currency,address targetCurrency,uint256 downPayment,uint256 principal,uint256 minTargetAmount,uint256 expiration,FunctionCallData[] functionCallDataList)FunctionCallData(address to,uint256 value,bytes data)");
    bytes32 private constant _POSITION_HASH =
        keccak256("Position(uint128 id,uint128 lastFundingTimestamp,address trader,address currency,address collateralCurrency,uint256 downPayment,uint256 principal,uint256 collateralAmount)");

    function hashFunctionCallData(IWasabiPerps.FunctionCallData memory _functionCallData) internal pure returns(bytes32) {
        return keccak256(abi.encode(
            _FUNCTION_CALL_DATA_HASH,
            _functionCallData.to,
            _functionCallData.value,
            _functionCallData.data
        ));
    }

    function hash(IWasabiPerps.OpenPositionRequest calldata _request) internal pure returns (bytes32) {
        bytes memory encodedFunctionCallDataList;
        for (uint256 i = 0; i < _request.functionCallDataList.length; ) {
            encodedFunctionCallDataList = abi.encodePacked(
                encodedFunctionCallDataList,
                hashFunctionCallData(_request.functionCallDataList[i])
            );

            unchecked {
                ++i;
            }
        }
        return keccak256(abi.encode(
            _OPEN_POSITION_REQUEST_HASH,
            _request.id,
            _request.currency,
            _request.targetCurrency,
            _request.downPayment,
            _request.principal,
            _request.minTargetAmount,
            _request.expiration,
            keccak256(encodedFunctionCallDataList)
        ));
    }

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