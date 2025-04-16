// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IExactOutSwapper {
    error TargetNotWhitelistedSwapRouter(address target);
    error InsufficientAmountOutReceived();

    /// @dev Defines a function call
    struct FunctionCallData {
        address to;
        uint256 value;
        bytes data;
    }

    // @dev Uses two exact input swaps to accomplish an exact output swap
    /// @param tokenIn The address of the input token
    /// @param tokenOut The address of the output token
    /// @param amountOut The amount of output tokens to receive
    /// @param amountInMax The maximum amount of input tokens to spend
    /// @param swapCallData The data for the first swap from tokenIn to tokenOut
    /// @param reverseCallData The data for the second swap, swapping excess tokenOut back to tokenIn
    /// @return amountIn The net amount of input tokens spent
    function swapExactOut(
        address tokenIn,
        address tokenOut,
        uint256 amountOut,
        uint256 amountInMax,
        FunctionCallData calldata swapCallData,
        FunctionCallData calldata reverseCallData
    ) external payable returns (uint256 amountIn);

    /// @dev Sets the whitelist status of a swap router
    /// @param swapRouter The address of the swap router
    /// @param isWhitelisted The whitelist status to set
    function setWhitelisted(address swapRouter, bool isWhitelisted) external;
}