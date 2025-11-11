// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

import {IExactOutSwapperV2} from "./IExactOutSwapperV2.sol";
import {PerpManager} from "../admin/PerpManager.sol";

contract ExactOutSwapperV2 is IExactOutSwapperV2, UUPSUpgradeable, OwnableUpgradeable {
    using Address for address;
    using Address for address payable;
    using SafeERC20 for IERC20;

    uint256 private constant DEFAULT_BUYBACK_DISCOUNT_BIPS = 100; // 1%
    uint256 private constant BPS_DENOMINATOR = 10000;

    mapping(address => mapping(address => uint256)) public buybackDiscountBips;
    mapping(address => bool) public isAuthorizedSwapCaller;

    /// @dev Checks if the caller is an admin
    modifier onlyAdmin() {
        _getManager().isAdmin(msg.sender);
        _;
    }

    /// @dev Checks if the caller is authorized to call swapExactOut
    modifier onlyAuthorizedSwapCaller() {
        if (!isAuthorizedSwapCaller[msg.sender]) revert UnauthorizedCaller();
        _;
    }
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address _manager, address[] calldata _authorizedSwapCallers) external initializer {
        __Ownable_init(_manager);
        __UUPSUpgradeable_init();
        for (uint256 i; i < _authorizedSwapCallers.length; ) {
            isAuthorizedSwapCaller[_authorizedSwapCallers[i]] = true;
            unchecked {
                ++i;
            }
        }
    }

    /// @inheritdoc IExactOutSwapperV2
    function swapExactOut(
        address tokenIn,
        address tokenOut,
        uint256 amountInMax,
        uint256 amountOut,
        address swapRouter,
        bytes calldata swapCalldata
    ) external onlyAuthorizedSwapCaller {
        // 1. Take amountInMax of tokenIn from the caller
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountInMax);
        uint256 outBalanceBefore = IERC20(tokenOut).balanceOf(address(this));

        // 2. execute swapCalldata: amountInMax of tokenIn -> amountOutFromSwap of tokenOut
        IERC20(tokenIn).forceApprove(swapRouter, amountInMax);
        swapRouter.functionCall(swapCalldata);
        uint256 amountOutFromSwap = IERC20(tokenOut).balanceOf(address(this)) - outBalanceBefore;
        if (amountOutFromSwap < amountOut) {
            revert InsufficientAmountOutReceived();
        }

        // 3. compute excess: amountOutFromSwap - amountOut = excess
        uint256 excess = amountOutFromSwap - amountOut;
        if (excess > 0) {
            // 4. compute buyback: excess * amountInMax / amountOutFromSwap * (10000 - discountBips) / 10000 = buybackAmount
            (address token0, address token1) = _sortTokens(tokenIn, tokenOut);
            uint256 buybackDiscount = buybackDiscountBips[token0][token1] != 0 ? buybackDiscountBips[token0][token1] : DEFAULT_BUYBACK_DISCOUNT_BIPS;
            uint256 buybackAmount = excess * amountInMax * (BPS_DENOMINATOR - buybackDiscount) / (BPS_DENOMINATOR * amountOutFromSwap);
            if (buybackAmount > IERC20(tokenIn).balanceOf(address(this))) {
                revert InsufficientTokenBalance();
            }
            if (buybackAmount > 0) {
                // 5. send buyback of tokenIn back to caller
                IERC20(tokenIn).safeTransfer(msg.sender, buybackAmount);
            }
            emit ExcessTokensPurchased(tokenOut, excess, tokenIn, buybackAmount);
        }

        // 6. send amountOut of tokenOut
        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }

    /// @inheritdoc IExactOutSwapperV2
    function withdrawTokens(
        address token,
        uint256 amount
    ) external onlyAdmin {
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    /// @inheritdoc IExactOutSwapperV2
    function sellExistingTokens(
        address token,
        uint256 amount,
        address swapRouter,
        bytes calldata swapCalldata
    ) external onlyAdmin {
        IERC20(token).forceApprove(swapRouter, amount);
        swapRouter.functionCall(swapCalldata);
    }

    /// @inheritdoc IExactOutSwapperV2
    function setBuybackDiscountBips(
        address tokenA,
        address tokenB,
        uint256 discountBips
    ) external onlyAdmin {
        (address token0, address token1) = _sortTokens(tokenA, tokenB);
        buybackDiscountBips[token0][token1] = discountBips;
    }

    /// @inheritdoc IExactOutSwapperV2
    function setAuthorizedSwapCaller(
        address swapper,
        bool isAuthorized
    ) external onlyAdmin {
        isAuthorizedSwapCaller[swapper] = isAuthorized;
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal view override onlyAdmin {}

    /// @dev returns the manager of the contract
    function _getManager() internal view returns (PerpManager) {
        return PerpManager(owner());
    }

    /// @dev Sorts two token addresses Uniswap style
    function _sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (token0, token1) = uint160(tokenA) < uint160(tokenB)
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
    }
}