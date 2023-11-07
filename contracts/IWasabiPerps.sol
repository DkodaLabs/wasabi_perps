// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IWasabiPerps {

    error LiquidationThresholdNotReached();
    error InvalidSignature();
    error PositionAlreadyTaken();
    error SwapFunctionNeeded();
    error OrderExpired();
    error InvalidCurrency();
    error InvalidTargetCurrency();
    error InsufficientAmountProvided();
    error PrincipalTooHigh();
    error InsufficientAvailablePrincipal();
    error InsufficientCollateralReceived();
    error SenderNotTrader();
    error InvalidPosition();

    event OpenPosition(
        uint256 positionId,
        address trader,
        address currency,
        address collateralCurrency,
        uint256 downPayment,
        uint256 principal,
        uint256 collateralAmount,
        uint256 feesToBePaid
    );

    event ClosePosition(
        uint256 id,
        address trader,
        uint256 payout,
        uint256 principalRepaid,
        uint256 interestPaid,
        uint256 feeAmount
    );

    event PositionLiquidated(
        uint256 id,
        address trader,
        uint256 payout,
        uint256 principalRepaid,
        uint256 interestPaid,
        uint256 feeAmount
    );

    error EthTransferFailed();


    struct FunctionCallData {
        address to;
        uint256 value;
        bytes data;
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
        uint256 feesToBePaid;
    }

    struct OpenPositionRequest {
        uint256 id;
        address currency;
        address targetCurrency;
        uint256 downPayment;
        uint256 principal;
        uint256 minTargetAmount;
        uint256 expiration;
        uint256 swapPrice;
        uint256 swapPriceDenominator;
        FunctionCallData[] functionCallDataList;
    }

    struct ClosePositionRequest {
        Position position;
        FunctionCallData[] functionCallDataList;
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

    /// @notice Opens a position
    /// @param _request the request to open a position
    /// @param _signature the signature of the request
    function openPosition(
        OpenPositionRequest calldata _request,
        Signature calldata _signature
    ) external payable;

    /// @notice Closes a position
    /// @param _request the request to close a position
    /// @param _signature the signature of the request
    function closePosition(
        ClosePositionRequest calldata _request,
        Signature calldata _signature
    ) external payable;

    /// @notice Liquidates a position
    /// @param _position the position to liquidate
    /// @param _swapFunctions the swap functions to use to liquidate the position
    function liquidatePosition(
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) external payable;

    /// @dev Withdraws any stuck ETH in this contract
    function withdrawETH(uint256 _amount) external payable;

    /// @dev Withdraws any stuck ERC20 in this contract
    function withdrawERC20(IERC20 _token, uint256 _amount) external;

    /// @dev Withdraws any stuck ERC721 in this contract
    function withdrawERC721(IERC721 _token, uint256 _tokenId) external;
}