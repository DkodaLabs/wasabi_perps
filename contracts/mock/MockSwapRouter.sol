// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "hardhat/console.sol";
import "./IMockSwap.sol";

contract MockSwapRouter {
    IMockSwap public mockSwap;

    constructor(IMockSwap _mockSwap) {
        mockSwap = _mockSwap;
    }

    function swap(
        address currencyIn,
        uint256 amountIn,
        address currencyOut,
        address recipient
    ) external payable returns(uint256 amountOut) {
        console.log("MockSwapRouter.swap");
        if (currencyIn != address(0) && msg.value == 0) {
            IERC20(currencyIn).transferFrom(msg.sender, address(this), amountIn);
            IERC20(currencyIn).approve(address(mockSwap), amountIn);
        }
        amountOut = mockSwap.swap{value: msg.value}(currencyIn, amountIn, currencyOut);
        if (recipient != address(this)) {
            console.log("Transferring %s %s to %s", amountOut, currencyOut, recipient);
            IERC20(currencyOut).transfer(recipient, amountOut);
        }
    }

    function swapExactlyOut(
        address currencyIn,
        address currencyOut,
        uint256 amountOut,
        address recipient
    ) external payable returns(uint256 amountIn) {
        amountIn = mockSwap.swapExactlyOut{value: msg.value}(currencyIn, currencyOut, amountOut);
        if (recipient != address(this))
            IERC20(currencyOut).transfer(recipient, amountOut);
    }

    function multicall(bytes[] calldata data) public payable returns (bytes[] memory results) {
        console.log("MockSwapRouter.multicall: data.length = %d", data.length);
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            console.log("i = %d", i);
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);

            if (!success) {
                console.log("failed");
                // Next 5 lines from https://ethereum.stackexchange.com/a/83577
                if (result.length < 68) revert();
                assembly {
                    result := add(result, 0x04)
                }
                revert(abi.decode(result, (string)));
            }

            results[i] = result;
        }
    }

    function sweepTokenWithFee(
        address token,
        uint256 amountMinimum,
        address recipient,
        uint256 feeBips,
        address feeRecipient
    ) public {
        require(feeBips > 0 && feeBips <= 100);

        uint256 balanceToken = IERC20(token).balanceOf(address(this));
        require(balanceToken >= amountMinimum, 'Insufficient token');

        if (balanceToken > 0) {
            uint256 feeAmount = balanceToken * feeBips / 10_000;
            if (feeAmount > 0) IERC20(token).transfer(feeRecipient, feeAmount);
            IERC20(token).transfer(recipient, balanceToken - feeAmount);
        }
    }
}