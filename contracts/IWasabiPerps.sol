// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IWasabiPerps {

    event OpenPosition(
        address trader,
        address currency,
        address collateralCurrency,
        uint256 downPayment,
        uint256 principal,
        uint256 collateralAmount
    );

    event ClosePosition(
        uint128 id,
        address trader,
        uint256 payout,
        uint256 repayAmount
    );

    event PositionLiquidated(
        uint128 id,
        address trader,
        uint256 payout,
        uint256 repayAmount
    );

    error EthTransferFailed();

    struct OpenPositionRequest {
        uint128 id;
        address currency;
        address targetCurrency;
        uint256 downPayment;
        uint256 principal;
        uint256 fee;
        uint256 minTargetAmount;
        uint256 expiration;
    }

    struct Position {
        uint128 id;
        uint128 lastFundingTimestamp;
        address trader;
        address currency;
        address collateralCurrency;
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