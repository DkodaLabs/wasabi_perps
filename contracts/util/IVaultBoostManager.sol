// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IVaultBoostManager {
    error VaultNotFound(address token);
    error InvalidBoostDuration();
    error InvalidBoostAmount();
    error BoostAlreadyActive();
    error BoostNotActive();

    event VaultBoostInitiated(
        address indexed vault,
        address indexed token,
        uint256 amount,
        uint256 startTimestamp,
        uint256 endTimestamp
    );

    event VaultBoostPayment(
        address indexed vault,
        address indexed token,
        uint256 amount
    );

    struct VaultBoost {
        address vault;
        uint256 startTimestamp;
        uint256 endTimestamp;
        uint256 lastPaymentTimestamp;
        uint256 amountRemaining;
    }

    /// @notice Initiates a boost for a vault
    /// @param token The token to boost with
    /// @param amount The total amount to be distributed over the duration
    /// @param duration The duration of the boost in seconds
    function initiateBoost(address token, uint256 amount, uint256 duration) external;

    /// @notice Makes a boost payment to the vault
    /// @param token The token to boost with
    function payBoost(address token) external;
}