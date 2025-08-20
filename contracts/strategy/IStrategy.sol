// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IStrategy {
    error OnlyVault();

    function vault() external view returns (address);

    function asset() external view returns (address);

    function collateralAsset() external view returns (address);

    function deposit(uint256 amount) external returns (address collateral, uint256 collateralIncreased);

    function withdraw(uint256 amount) external returns (address collateral, uint256 collateralSold);

    function getNewInterest(uint256 lastObservedAmount) external view returns (uint256 interestReceived);
}
