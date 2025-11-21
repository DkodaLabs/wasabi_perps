// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IVaultBoostManager.sol";
import "../admin/PerpManager.sol";
import "../vaults/IWasabiVault.sol";
import "../IWasabiPerps.sol";

contract VaultBoostManager is IVaultBoostManager, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice The short pool contract used to resolve vault addresses from tokens
    IWasabiPerps public shortPool;

    /// @notice Mapping from token address to boost state
    mapping(address => VaultBoost) public boosts;

    /// @dev Minimum boost duration
    uint256 public constant MIN_DURATION = 1 days;

    /// @dev Checks if the caller is an admin
    modifier onlyAdmin() {
        _getManager().isAdmin(msg.sender);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Initializes the contract
    /// @param _manager The PerpManager contract that will own this vault
    function initialize(PerpManager _manager, IWasabiPerps _shortPool) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(address(_manager));
        __ReentrancyGuard_init();
        shortPool = _shortPool;
    }

    /// @inheritdoc IVaultBoostManager
    function initiateBoost(address token, uint256 amount, uint256 startTimestamp, uint256 duration) external nonReentrant {
        // Validate the input
        if (duration < MIN_DURATION) revert InvalidBoostDuration();
        if (amount == 0) revert InvalidBoostAmount();
        if (startTimestamp < block.timestamp) revert InvalidBoostStartTimestamp();
        if (boosts[token].amountRemaining != 0) revert BoostAlreadyActive();
        
        // Ensure the vault exists (call reverts if not found)
        IWasabiVault vault = shortPool.getVault(token);

        // Transfer the amount to the contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Pre-approve the vault to spend the amount to avoid multiple approvals in the payBoost function
        IERC20(token).forceApprove(address(vault), amount);

        // Store the boost state and emit the event
        boosts[token] = VaultBoost({
            vault: address(vault),
            startTimestamp: startTimestamp,
            endTimestamp: startTimestamp + duration,
            lastPaymentTimestamp: 0,
            amountRemaining: amount
        });
        emit VaultBoostInitiated(address(vault), token, amount, startTimestamp, startTimestamp + duration);
    }

    /// @inheritdoc IVaultBoostManager
    function payBoost(address token) external onlyAdmin nonReentrant {
        VaultBoost storage boost = boosts[token];
        if (boost.amountRemaining == 0 || block.timestamp < boost.startTimestamp) revert BoostNotActive();

        // Determine the distribution period for this boost payment
        // - First distribution period starts at the boost start timestamp and ends at block.timestamp
        // - Last distribution period starts at the last payment timestamp and ends at the boost end timestamp
        // - Otherwise, the distribution period starts at the last payment timestamp and ends at block.timestamp
        uint256 distributionStart = boost.lastPaymentTimestamp == 0 ? boost.startTimestamp : boost.lastPaymentTimestamp;
        uint256 distributionEnd = _min(boost.endTimestamp, block.timestamp);

        // If nothing to distribute (e.g., called twice in same block or after end), revert
        if (distributionEnd <= distributionStart) revert NoDistributionPending();

        uint256 distributionDuration = distributionEnd - distributionStart;
        uint256 remainingDuration = boost.endTimestamp - distributionStart;
        if (remainingDuration == 0) revert BoostNotActive();

        // Calculate the amount to pay for this distribution period, based on the amount of tokens remaining and time remaining
        uint256 amountToPay = boost.amountRemaining * distributionDuration / remainingDuration;
        if (amountToPay == 0) {
            // To avoid stuck boosts due to division rounding, if end is reached, pay full remaining.
            if (distributionEnd == boost.endTimestamp) {
                amountToPay = boost.amountRemaining;
            } else {
                // Otherwise nothing meaningful to distribute now
                revert NoDistributionPending();
            }
        }
        
        // Donate the amount to pay to the vault
        address vault = boost.vault;
        IWasabiVault(vault).donate(amountToPay);

        // Update the boost state and emit the event
        boost.lastPaymentTimestamp = block.timestamp;
        boost.amountRemaining -= amountToPay;
        emit VaultBoostPayment(vault, token, amountToPay);
    }

    /// @inheritdoc IVaultBoostManager
    function recoverTokens(address token, address to, uint256 amount) external onlyAdmin {
        // Admin should avoid recovering tokens that belong to active boosts.
        IERC20(token).safeTransfer(to, amount);
    }

    /// @dev Returns the minimum of two uint256 values
    /// @param a The first value
    /// @param b The second value
    /// @return The minimum value
    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal view override onlyAdmin {}

    /// @dev returns the manager of the contract
    function _getManager() internal view returns (PerpManager) {
        return PerpManager(owner());
    }
}