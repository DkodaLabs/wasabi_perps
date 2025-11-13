// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IWasabiPerps} from "../IWasabiPerps.sol";

interface IExactOutSwapperV2 {
    error InsufficientAmountOutReceived(); // 0x545831f6
    error InsufficientTokenBalance(); // 0xe4455cae
    error UnauthorizedCaller(); // 0x5c427cd9
    error IdenticalAddresses(); // 0x6706352a
    error ZeroAddress(); // 0x4dfe177d

    event ExcessTokensPurchased(
        address excessToken,
        uint256 excessAmount,
        address buybackToken,
        uint256 buybackAmount
    );

    event ExcessTokensSold(
        address tokenIn,
        uint256 amountIn,
        address tokenOut,
        uint256 amountOut
    );

    /// @dev Swaps amountInMax of tokenIn and buys any excess amount of tokenOut, returning amountOut of tokenOut plus some amount of tokenIn to the caller.
    /// @param tokenIn The address of the input token
    /// @param tokenOut The address of the output token
    /// @param amountInMax The maximum amount of input tokens to spend
    /// @param amountOut The amount of output tokens to receive
    /// @param swapCalldata The calldata for the swap
    function swapExactOut(
        address tokenIn,
        address tokenOut,
        uint256 amountInMax,
        uint256 amountOut,
        IWasabiPerps.FunctionCallData calldata swapCalldata
    ) external;

    /// @dev Called by the admin to withdraw ERC20 tokens from the contract.
    /// @param token The address of the token to withdraw
    /// @param amount The amount of tokens to withdraw
    function withdrawTokens(
        address token,
        uint256 amount
    ) external;

    /// @dev Called by the admin to sell tokens that were purchased as excess from a swap.
    /// @param tokenIn The address of the input token
    /// @param tokenOut The address of the output token
    /// @param amountInMax The maximum amount of input tokens to sell
    /// @param swapCalldata The calldata for the swap
    function sellExistingTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountInMax,
        IWasabiPerps.FunctionCallData calldata swapCalldata
    ) external;

    /// @dev Called by the admin to set the buyback discount for a pair of tokens.
    /// @param tokenA The address of the first token
    /// @param tokenB The address of the second token
    /// @param discountBips The buyback discount in basis points
    function setBuybackDiscountBips(
        address tokenA,
        address tokenB,
        uint256 discountBips
    ) external;

    /// @dev Called by the admin to specify which addresses are authorized to call swapExactOut.
    /// @param swapper The address of the swap caller
    /// @param isAuthorized The authorized status to set
    function setAuthorizedSwapCaller(
        address swapper,
        bool isAuthorized
    ) external;

    /// @dev Returns the buyback discount for a pair of tokens.
    /// @param tokenA The address of the first token
    /// @param tokenB The address of the second token
    /// @return discountBips The buyback discount in basis points
    function getBuybackDiscountBips(
        address tokenA,
        address tokenB
    ) external view returns (uint256);
}