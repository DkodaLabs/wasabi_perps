// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IVaultBoostManager {
    error InvalidBoostDuration();
    error InvalidBoostAmount();
    error InvalidBoostStartTimestamp();
    error InvalidBoostIndex();
    error BoostNotActive();
    error InsufficientTokenBalance();

    event VaultBoostInitiated(
        address indexed vault,
        address indexed token,
        address indexed boostedBy,
        uint256 amount,
        uint256 startTimestamp,
        uint256 endTimestamp
    );

    event VaultBoostPayment(
        address indexed vault,
        address indexed token,
        uint256 amount
    );

    event VaultBoostCancelled(
        address indexed vault,
        address indexed token,
        address indexed boostedBy,
        uint256 createdAtTimestamp,
        uint256 amountReturned
    );

    struct VaultBoost {
        address vault;
        address boostedBy;
        uint256 createdAtTimestamp;
        uint256 startTimestamp;
        uint256 endTimestamp;
        uint256 lastPaymentTimestamp;
        uint256 amountRemaining;
    }

    /// @notice Initiates a boost for a vault
    /// @param token The token to boost with
    /// @param amount The total amount to be distributed over the duration
    /// @param startTimestamp The timestamp when the boost starts
    /// @param duration The duration of the boost in seconds
    function initiateBoost(address token, uint256 amount, uint256 startTimestamp, uint256 duration) external;

    /// @notice Makes boost payments to the vault for all boosts for a token
    /// @param token The token to pay boosts with
    function payBoosts(address token) external;

    /// @notice Cancels a boost for a vault and sends the remaining tokens back to the boostedBy address
    /// @param token The token to cancel the boost for
    /// @param index The index of the boost to cancel
    function cancelBoost(address token, uint256 index) external;

    /// @notice Recover any tokens accidentally sent to this contract (only owner).
    /// @param token token to recover
    /// @param to recipient
    /// @param amount amount to recover
    function recoverTokens(address token, address to, uint256 amount) external;

    /// @notice Returns an array of the boosts for a token
    /// @param token The token to get the boosts for
    /// @return boosts An array of the boosts for a token
    function getBoosts(address token) external view returns (VaultBoost[] memory);

    /// @notice Returns the amount of tokens that would be paid out at a given timestamp for a boost
    /// @param token The token to get the amount for
    /// @param index The index of the boost to get the amount for
    /// @param timestamp The timestamp to get the amount for
    function previewBoostPayment(address token, uint256 index, uint256 timestamp) external view returns (uint256);

    /// @notice Returns the amount of tokens that would be paid out at a given timestamp for all boosts for a token
    /// @param token The token to get the amount for
    /// @param timestamp The timestamp to get the amount for
    function previewBoostPayments(address token, uint256 timestamp) external view returns (uint256);
}