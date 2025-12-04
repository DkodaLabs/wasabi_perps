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
    mapping(address => VaultBoost[]) public boostsByToken;

    /// @dev Minimum boost duration
    uint256 public constant MIN_DURATION = 14 days;

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
        
        // Ensure the vault exists (call reverts if not found)
        IWasabiVault vault = shortPool.getVault(token);

        // Transfer the amount to the contract
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        // Pre-approve the vault to spend the amount to avoid multiple approvals in the payBoost function
        IERC20(token).forceApprove(address(vault), amount);

        // Store the boost state and emit the event
        boostsByToken[token].push(VaultBoost({
            vault: address(vault),
            boostedBy: msg.sender,
            startTimestamp: startTimestamp,
            endTimestamp: startTimestamp + duration,
            lastPaymentTimestamp: 0,
            amountRemaining: amount
        }));
        emit VaultBoostInitiated(address(vault), token, msg.sender, amount, startTimestamp, startTimestamp + duration);
    }

    /// @inheritdoc IVaultBoostManager
    function payBoosts(address token) external onlyAdmin nonReentrant {
        VaultBoost[] storage boosts = boostsByToken[token];
        uint256 numBoosts = boosts.length;
        if (numBoosts == 0) revert BoostNotActive();
        
        for (uint256 i; i < numBoosts; ) {
            VaultBoost storage boost = boosts[i];
            if (boost.amountRemaining == 0 || block.timestamp < boost.startTimestamp) {
                unchecked { ++i; }
                continue;
            }

            // Get the amount to pay for this boost payment
            uint256 amountToPay = previewBoostPayment(token, i, block.timestamp);
            if (amountToPay == 0) {
                unchecked { ++i; }
                continue;
            }
            
            // Donate the amount to pay to the vault
            address vault = boost.vault;
            IWasabiVault(vault).donate(amountToPay);

            // Update the boost state and emit the event
            boost.lastPaymentTimestamp = block.timestamp;
            boost.amountRemaining -= amountToPay;
            emit VaultBoostPayment(vault, token, amountToPay);
            unchecked { 
                ++i; 
            }
        }
    }

    /// @inheritdoc IVaultBoostManager
    function cancelBoost(address token, uint256 index) external onlyAdmin nonReentrant {
        // Validate the input
        VaultBoost[] storage boosts = boostsByToken[token];
        if (index >= boosts.length) revert InvalidBoostIndex();

        // Get the boost and validate the amount remaining
        VaultBoost storage boost = boosts[index];
        uint256 amountRemaining = boost.amountRemaining;
        if (amountRemaining == 0) revert BoostNotActive();

        // Cancel the boost and transfer the remaining tokens back to the boostedBy address
        boost.amountRemaining = 0;
        IERC20(token).safeTransfer(boost.boostedBy, amountRemaining);
        emit VaultBoostCancelled(boost.vault, token, boost.boostedBy, amountRemaining);
    }

    /// @inheritdoc IVaultBoostManager
    function recoverTokens(address token, address to, uint256 amount) external onlyAdmin {
        uint256 balance = IERC20(token).balanceOf(address(this));
        // Make sure the amount is not greater than the balance
        if (amount > balance) revert InsufficientTokenBalance();
        
        // Make sure the tokens are not part of an active boost
        VaultBoost[] memory boosts = boostsByToken[token];
        uint256 totalBoostAmount = 0;
        for (uint256 i; i < boosts.length; ) {
            totalBoostAmount += boosts[i].amountRemaining;
            unchecked { ++i; }
        }
        if (balance - amount < totalBoostAmount) revert InsufficientTokenBalance();

        // Transfer the tokens to the recipient
        IERC20(token).safeTransfer(to, amount);
    }

    /// @inheritdoc IVaultBoostManager
    function getBoosts(address token) external view returns (VaultBoost[] memory) {
        return boostsByToken[token];
    }

    /// @inheritdoc IVaultBoostManager
    function previewBoostPayment(address token, uint256 index, uint256 timestamp) public view returns (uint256) {
        VaultBoost[] memory boosts = boostsByToken[token];
        if (index >= boosts.length) revert InvalidBoostIndex();
        VaultBoost memory boost = boosts[index];

        // If the timestamp is before the boost start timestamp or the boost has no amount remaining, return 0
        if (timestamp < boost.startTimestamp || boost.amountRemaining == 0) return 0;

        // Determine the distribution period for this boost payment, based on the last payment timestamp
        // - First distribution period starts at the boost start timestamp and ends at the timestamp
        // - Last distribution period starts at the last payment timestamp and ends at the boost end timestamp
        // - Otherwise, the distribution period starts at the last payment timestamp and ends at the timestamp
        uint256 distributionStart = boost.lastPaymentTimestamp == 0 ? boost.startTimestamp : boost.lastPaymentTimestamp;
        uint256 distributionEnd = _min(boost.endTimestamp, timestamp);

        // If nothing to distribute (e.g., called twice in same block or after end), return 0
        if (distributionEnd <= distributionStart) return 0;

        uint256 distributionDuration = distributionEnd - distributionStart;
        uint256 remainingDuration = boost.endTimestamp - distributionStart;

        // Calculate the amount to pay for this distribution period, based on the amount of tokens remaining and time remaining
        return boost.amountRemaining * distributionDuration / remainingDuration;
    }

    /// @inheritdoc IVaultBoostManager
    function previewBoostPayments(address token, uint256 timestamp) external view returns (uint256) {
        VaultBoost[] memory boosts = boostsByToken[token];
        uint256 numBoosts = boosts.length;
        uint256 totalAmountToPay = 0;
        for (uint256 i; i < numBoosts; ) {
            totalAmountToPay += previewBoostPayment(token, i, timestamp);
            unchecked { ++i; }
        }
        return totalAmountToPay;
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