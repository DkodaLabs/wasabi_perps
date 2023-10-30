// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

import "./IDebtController.sol";

contract DebtController is Ownable, IDebtController {

    uint256 public constant LEVERAGE_DENOMINATOR = 100;
    uint256 public constant APY_DENOMINATOR = 100;

    uint256 public maxApy; // 300% APR will be 300
    uint256 public maxLeverage; // e.g. 3x leverage = 300

    /// @notice creates a new DebtController
    /// @param _maxApy the max apy
    /// @param _maxLeverage the max leverage
    constructor(uint256 _maxApy, uint256 _maxLeverage) Ownable(msg.sender) {
        maxApy = _maxApy;
        maxLeverage = _maxLeverage;
    }

    /// @inheritdoc IDebtController
    function computeMaxDebt(
        address,
        address,
        uint256 _principal,
        uint256 _lastFundingTimestamp
    ) external view returns(uint256 debt) {
        uint256 secondsSince = block.timestamp - _lastFundingTimestamp;
        uint256 maxInterestToPay = _principal * maxApy / APY_DENOMINATOR * secondsSince / (365 days);
        debt = _principal + maxInterestToPay;
    }

    /// @inheritdoc IDebtController
    function computeMaxPrincipal(
        address,
        address,
        uint256 _downPayment
    ) external view returns (uint256 maxPrincipal) {
        maxPrincipal = _downPayment * (maxLeverage - LEVERAGE_DENOMINATOR) / LEVERAGE_DENOMINATOR;
    }


    /// @notice sets the maximum leverage
    /// @param _maxLeverage the max leverage 
    function setMaxLeverage(uint256 _maxLeverage) external onlyOwner {
        maxLeverage = _maxLeverage;
    }

    /// @notice sets the maximum apy
    /// @param _maxApy the max APY 
    function setMaxDailyAPY(uint256 _maxApy) external onlyOwner {
        maxApy = _maxApy;
    }
}