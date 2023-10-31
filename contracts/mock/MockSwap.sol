// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockSwap {

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
        uint256 price = prices[currencyIn][currencyOut];
        require(price > 0, 'Price Not Set');

        amountOut = amountIn * price / PRICE_DENOMINATOR;

        if (currencyIn == address(0)) {
            require(msg.value == amountIn, 'Not enough ETH supplied');
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