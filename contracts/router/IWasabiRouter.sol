// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../IWasabiPerps.sol";
import "../weth/IWETH.sol";

interface IWasabiRouter {

    event PositionOpenedWithOrder(address _trader, bytes32 _orderHash);

    error InvalidTrader(); // 0xfb7595a2
    error InvalidSignature(); // 0x8baa579f
    error InvalidPool(); // 0x2083cd40
    error InvalidETHReceived(); // 0x3daee882
    error InvalidFeeBips(); // 0x82c96382
    error FeeReceiverNotSet(); // 0x0b37568b
    error OrderAlreadyUsed(); // 0x88b39043

    // State variables
    function longPool() external view returns (IWasabiPerps);
    function shortPool() external view returns (IWasabiPerps);
    function weth() external view returns (IWETH);
    function swapRouter() external view returns (address);
    function feeReceiver() external view returns (address);
    function withdrawFeeBips() external view returns (uint256);

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
    /// @param _trader The trader to open the position for
    /// @param _pool The pool to open the position on
    /// @param _request The request to open the position
    /// @param _signature The signature for the request (from ORDER_SIGNER_ROLE, validated by the pool)
    /// @param _traderSignature The signature from the trader or their authorized signer (validated using ERC-1271 if `_trader` is a smart contract wallet)
    /// @param _executionFee The fee to be paid to the order executor
    function openPosition(
        address _trader,
        IWasabiPerps _pool,
        IWasabiPerps.OpenPositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature,
        bytes calldata _traderSignature,
        uint256 _executionFee
    ) external;

    /// @dev Adds collateral to a position on behalf of a trader using their vault deposits
    /// @param _pool The pool to add collateral to
    /// @param _request The request to add collateral
    /// @param _signature The signature for the request (from ORDER_SIGNER_ROLE)
    function addCollateral(
        IWasabiPerps _pool,
        IWasabiPerps.AddCollateralRequest calldata _request,
        IWasabiPerps.Signature calldata _signature
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