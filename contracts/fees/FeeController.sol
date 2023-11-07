// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./IFeeController.sol";

contract FeeController is Ownable, IFeeController {
    address private feeReceiver;
    uint256 private tradeFeeValue;
    uint256 private swapFeeValue;

    uint256 public constant FEE_DENOMINATOR = 10_000;

    constructor(
        address _feeReceiver,
        uint256 _tradeFeeValue,
        uint256 _swapFeeValue
    ) Ownable(msg.sender) {
        feeReceiver = _feeReceiver;
        tradeFeeValue = _tradeFeeValue;
        swapFeeValue = _swapFeeValue;
    }

    /// @inheritdoc IFeeController
    function getFeeReceiver() external view returns (address) {
        return feeReceiver;
    }

    /// @inheritdoc IFeeController
    function computeTradeFee(
        uint256 amount
    ) external view returns (uint256 feeAmount) {
        feeAmount = amount * tradeFeeValue / FEE_DENOMINATOR;
    }

    /// @inheritdoc IFeeController
    function computeTradeAndSwapFee(uint256 amount) external view returns (uint256 feeAmount) {
        feeAmount = amount * (tradeFeeValue + swapFeeValue) / FEE_DENOMINATOR;
    }

    function setFeeReceiver(address _feeReceiver) external onlyOwner {
        require(_feeReceiver != address(0), "FeeController: fee receiver cannot be zero address");
        feeReceiver = _feeReceiver;
    }

    function setTradeFeeValue(uint256 _tradeFeeValue) external onlyOwner {
        tradeFeeValue = _tradeFeeValue;
    }

    function setSwapFeeValue(uint256 _swapFeeValue) external onlyOwner {
        swapFeeValue = _swapFeeValue;
    }
}