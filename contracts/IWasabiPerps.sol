// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IWasabiPerps {

    event OpenPosition(
        uint256 positionId,
        address trader,
        address currency,
        address collateralCurrency,
        uint256 downPayment,
        uint256 principal,
        uint256 collateralAmount
    );

    event ClosePosition(
        uint256 id,
        address trader,
        uint256 payout,
        uint256 repayAmount,
        uint256 feeAmount
    );

    event PositionLiquidated(
        uint256 id,
        address trader,
        uint256 payout,
        uint256 repayAmount,
        uint256 feeAmount
    );

    error EthTransferFailed();

    struct ClosePositionRequest {
        Position position;
        FunctionCallData[] functionCallDataList;
    }

    struct OpenPositionRequest {
        uint256 id;
        address currency;
        address targetCurrency;
        uint256 downPayment;
        uint256 principal;
        uint256 minTargetAmount;
        uint256 expiration;
        FunctionCallData[] functionCallDataList;
    }

    struct Position {
        uint256 id;
        address trader;
        address currency;
        address collateralCurrency;
        uint256 lastFundingTimestamp;
        uint256 downPayment;
        uint256 principal;
        uint256 collateralAmount;
    }

    struct FunctionCallData {
        address to;
        uint256 value;
        bytes data;
    }

    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct EIP712Domain {
        string name;
        string version;
        uint256 chainId;
        address verifyingContract;
    }

    /// @dev Withdraws any stuck ETH in this contract
    function withdrawETH(uint256 _amount) external payable;

    /// @dev Withdraws any stuck ERC20 in this contract
    function withdrawERC20(IERC20 _token, uint256 _amount) external;

    /// @dev Withdraws any stuck ERC721 in this contract
    function withdrawERC721(IERC721 _token, uint256 _tokenId) external;
}