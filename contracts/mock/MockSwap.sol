// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import "hardhat/console.sol";

contract MockSwap {
    error SwapReverted();

    event Swap(
        address currencyIn,
        uint256 amountIn,
        address currencyOut,
        uint256 amountOut
    );

    uint256 public constant PRICE_DENOMINATOR = 10_000;
    mapping (address => mapping(address => uint256)) prices;

    constructor() payable {}

    function swap(
        address currencyIn,
        uint256 amountIn,
        address currencyOut
    ) external payable returns(uint256 amountOut) {
        // console.log('swapping');
        uint256 price = prices[currencyIn][currencyOut];
        require(price > 0, 'Price Not Set');

        amountOut = amountIn * price / PRICE_DENOMINATOR;

        if (currencyIn == address(0)) {
            require(msg.value == amountIn, 'Not enough ETH supplied');
        } else {
            // console.log("Transferring %s %s", amountIn, currencyIn);
            IERC20(currencyIn).transferFrom(msg.sender, address(this), amountIn);
            // console.log('Payment received');
        }

        if (currencyOut == address(0)) {
            payETH(amountOut, msg.sender);
        } else {
            // console.log("Transferring %s %s. Current balance %s", amountOut, currencyOut, IERC20(currencyOut).balanceOf(address(this)));
            IERC20(currencyOut).transfer(msg.sender, amountOut);
            // console.log('Payment sent');
        }

        emit Swap(currencyIn, amountIn, currencyOut, amountOut);
    }

    function swapExact(
        address currencyIn,
        uint256 amountIn,
        address currencyOut,
        uint256 amountOut
    ) external payable returns(uint256) {
        if (currencyIn == address(0)) {
            require(msg.value == amountIn, 'Not enough ETH supplied');
        } else {
            IERC20(currencyIn).transferFrom(msg.sender, address(this), amountIn);
            // console.log('Payment received');
        }
        
        if (currencyOut == address(0)) {
            payETH(amountOut, msg.sender);
        } else {
            // console.log("Transferring %s %s. Current balance %s", amountOut, currencyOut, IERC20(currencyOut).balanceOf(address(this)));
            IERC20(currencyOut).transfer(msg.sender, amountOut);
            // console.log('Payment sent');
        }

        emit Swap(currencyIn, amountIn, currencyOut, amountOut);

        return amountOut;
    }

    function swapExactlyOut(
        address currencyIn,
        address currencyOut,
        uint256 amountOut
    ) external payable returns(uint256 amountIn) {
        uint256 price = prices[currencyIn][currencyOut];
        require(price > 0, 'Price Not Set');

        amountIn = amountOut * PRICE_DENOMINATOR / price;

        if (currencyIn == address(0)) {
            require(msg.value >= amountIn, 'Not enough ETH supplied');
            if (msg.value > amountIn) {
                // console.log('Returning %s ETH to %s', msg.value - amountIn, msg.sender);
                payETH(msg.value - amountIn, msg.sender);
            }
        } else {
            IERC20(currencyIn).transferFrom(msg.sender, address(this), amountIn);
        }

        if (currencyOut == address(0)) {
            payETH(amountOut, msg.sender);
        } else {
            IERC20(currencyOut).transfer(msg.sender, amountOut);
        }

        emit Swap(currencyIn, amountIn, currencyOut, amountOut);
    }

    function revertingFunction() external payable {
        revert SwapReverted();
    }

    function setPrice(address token1, address token2, uint256 price) external {
        prices[token1][token2] = price;
        prices[token2][token1] = PRICE_DENOMINATOR * PRICE_DENOMINATOR / price;
    }
    
    function payETH(uint256 _amount, address target) private {
        (bool sent, ) = payable(target).call{value: _amount}("");
        require(sent, 'Couldnt send eth');
    }

    receive() external payable virtual {}

    fallback() external payable {
        require(false, "No fallback");
    }
}