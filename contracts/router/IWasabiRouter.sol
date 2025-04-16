// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../IWasabiPerps.sol";
import "../weth/IWETH.sol";

interface IWasabiRouter {

    event SwapRouterUpdated(address _oldSwapRouter, address _newSwapRouter);
    event WithdrawFeeUpdated(uint256 _oldFeeBips, uint256 _newFeeBips);

    error InvalidSignature();
    error InvalidPool();
    error InvalidETHReceived();
    error InvalidFeeBips();
    error FeeReceiverNotSet();
    error InsufficientAmountOutReceived();

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

    /// @dev Withdraws assets from one vault, swaps and deposits them into another vault on the sender's behalf
    /// @param _amount The amount of `_tokenIn` to withdraw
    /// @param _tokenIn The asset to withdraw and swap
    /// @param _tokenOut The asset to swap for and deposit
    /// @param _swapCalldata The encoded calldata to send to the swap router
    function swapVaultToVault(
        uint256 _amount,
        address _tokenIn,
        address _tokenOut,
        bytes calldata _swapCalldata
    ) external;

    /// @dev Withdraws assets from a vault on the sender's behalf, swaps for another asset and sends the output to the sender
    /// @param _amount The amount of `_tokenIn` to withdraw
    /// @param _tokenIn The asset to withdraw and swap
    /// @param _tokenOut The asset to swap for and send to the user
    /// @param _swapCalldata The encoded calldata to send to the swap router
    function swapVaultToToken(
        uint256 _amount,
        address _tokenIn,
        address _tokenOut,
        bytes calldata _swapCalldata
    ) external;

    /// @dev Transfers assets in from the sender, swaps for another asset and deposits the output into the corresponding vault
    /// @param _amount The amount of `_tokenIn` to transfer from the user
    /// @param _tokenIn The asset to transfer from the user and swap, or the zero address for swapping native ETH
    /// @param _tokenOut The asset to swap for and deposit
    /// @param _swapCalldata The encoded calldata to send to the swap router
    function swapTokenToVault(
        uint256 _amount,
        address _tokenIn,
        address _tokenOut,
        bytes calldata _swapCalldata
    ) external payable;

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
        IWasabiPerps.FunctionCallData calldata swapCallData,
        IWasabiPerps.FunctionCallData calldata reverseCallData
    ) external payable returns (uint256 amountIn);
    
    /// @dev Transfers any assets stuck in the contract to the admin
    /// @param _token The token to sweep, or the zero address to sweep ETH
    function sweepToken(address _token) external;

    /// @dev Updates the address of the swap router contract
    /// @param _newSwapRouter The address of the new swap router to use
    function setSwapRouter(
        address _newSwapRouter
    ) external;

    /// @dev Updates the address of the WETH contract
    /// @param _newWETH The WETH contract
    function setWETH(
        IWETH _newWETH
    ) external;

    /// @dev Sets the address that receives fees for withdrawing from a vault w/o swapping
    /// @param _newFeeReceiver The fee receiver address
    function setFeeReceiver(
        address _newFeeReceiver
    ) external;

    /// @dev Updates the fee percentage charged for withdrawing from a vault w/o swapping
    /// @param _feeBips The new fee percentage in basis points
    function setWithdrawFeeBips(
        uint256 _feeBips
    ) external;
}