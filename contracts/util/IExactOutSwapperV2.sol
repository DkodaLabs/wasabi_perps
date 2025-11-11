// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IExactOutSwapperV2 {
    error InsufficientAmountOutReceived(); // 0x545831f6
    error InsufficientTokenBalance(); // 0xe4455cae
    error CallerNotPool(); // 0xe9211597

    event ExcessTokensPurchased(
        address excessToken,
        uint256 excessAmount,
        address buybackToken,
        uint256 buybackAmount
    );

    /// @dev Swaps amountInMax of tokenIn and buys any excess amount of tokenOut, returning amountOut of tokenOut plus some amount of tokenIn to the caller.
    /// @param tokenIn The address of the input token
    /// @param tokenOut The address of the output token
    /// @param amountInMax The maximum amount of input tokens to spend
    /// @param amountOut The amount of output tokens to receive
    /// @param swapRouter The address of the swap router
    /// @param swapCalldata The calldata for the swap
    function swapExactOut(
        address tokenIn,
        address tokenOut,
        uint256 amountInMax,
        uint256 amountOut,
        address swapRouter,
        bytes calldata swapCalldata
    ) external;

    /// @dev Called by the admin to sell tokens that were purchased as excess from a swap.
    /// @param token The address of the token to sell
    /// @param amount The amount of tokens to sell
    /// @param swapRouter The address of the swap router
    /// @param swapCalldata The calldata for the swap
    function sellExistingTokens(
        address token,
        uint256 amount,
        address swapRouter,
        bytes calldata swapCalldata
    ) external;

    /// @dev Called by the admin to set the buyback discount for a token.
    /// @param token The address of the token to set the buyback discount for
    /// @param discountBips The buyback discount in basis points
    function setBuybackDiscountBips(
        address token,
        uint256 discountBips
    ) external;
}