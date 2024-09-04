// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IWasabiRouter.sol";
import "../IWasabiPerps.sol";
import "../vaults/IWasabiVault.sol";
import "../admin/PerpManager.sol";
import "../admin/Roles.sol";
import "../Hash.sol";

contract WasabiRouter is
    IWasabiRouter,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    OwnableUpgradeable
{
    using Hash for IWasabiPerps.OpenPositionRequest;
    using SafeERC20 for IERC20;

    IWasabiPerps public longPool;
    IWasabiPerps public shortPool;

    /**
     * @dev Checks if the caller has the correct role
     */
    modifier onlyRole(uint64 roleId) {
        _getManager().checkRole(roleId, msg.sender);
        _;
    }

    /**
     * @dev Checks if the caller is an admin
     */
    modifier onlyAdmin() {
        _getManager().isAdmin(msg.sender);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Initializes the router as per UUPSUpgradeable
    /// @param _longPool The long pool address
    /// @param _shortPool The short pool address
    /// @param _manager The PerpManager address
    function initialize(
        IWasabiPerps _longPool,
        IWasabiPerps _shortPool,
        PerpManager _manager
    ) public virtual initializer {
        __Ownable_init(address(_manager));
        __ReentrancyGuard_init();
        __EIP712_init("WasabiRouter", "1");
        __UUPSUpgradeable_init();

        longPool = _longPool;
        shortPool = _shortPool;
    }

    /// @inheritdoc IWasabiRouter
    function openPosition(
        IWasabiPerps _pool,
        IWasabiPerps.OpenPositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature
    ) external nonReentrant {
        _openPositionInternal(_pool, _request, _signature, msg.sender, 0);
    }

    /// @inheritdoc IWasabiRouter
    function openPosition(
        IWasabiPerps _pool,
        IWasabiPerps.OpenPositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature,
        IWasabiPerps.Signature calldata _traderSignature,
        uint256 _executionFee
    ) external onlyRole(Roles.ORDER_EXECUTOR_ROLE) nonReentrant {
        IWasabiPerps.OpenPositionRequest memory traderRequest = IWasabiPerps
            .OpenPositionRequest(
                _request.id,
                _request.currency,
                _request.targetCurrency,
                _request.downPayment,
                _request.principal,
                _request.minTargetAmount,
                _request.expiration,
                _request.fee,
                new IWasabiPerps.FunctionCallData[](0)
            );
        address trader = _recoverSigner(traderRequest.hash(), _traderSignature);
        _openPositionInternal(_pool, _request, _signature, trader, _executionFee);
    }

    function _openPositionInternal(
        IWasabiPerps _pool,
        IWasabiPerps.OpenPositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature,
        address _trader,
        uint256 _executionFee
    ) internal {
        if (_pool != longPool) {
            // Nested checks save a little gas over && operator
            if (_pool != shortPool) revert InvalidPool();
        }

        // Currency to withdraw from vault for payment - always the quote currency
        address currency = _pool == longPool
            ? _request.currency
            : _request.targetCurrency;
        uint256 amount = _request.downPayment + _request.fee + _executionFee;

        // Vault to withdraw from - only the long pool stores vaults for quote tokens
        IWasabiVault vault = longPool.getVault(currency);
        vault.withdraw(amount, address(this), _trader);

        // If the pool is not approved to transfer the currency from the router, approve it
        if (
            IERC20(currency).allowance(address(this), address(_pool)) == 0
        ) {
            IERC20(currency).forceApprove(address(_pool), type(uint256).max);
        }

        // Open the position on behalf of the trader
        _pool.openPosition(_request, _signature, _trader);

        // Transfer the execution fee
        if (_executionFee != 0) {
            IERC20(currency).safeTransfer(
                msg.sender,
                _executionFee
            );
        }
    }

    /// @dev Checks if the signer for the given structHash and signature is the expected signer
    /// @param _structHash the struct hash
    /// @param _signature the signature
    function _recoverSigner(
        bytes32 _structHash,
        IWasabiPerps.Signature calldata _signature
    ) internal view returns (address signer) {
        bytes32 typedDataHash = _hashTypedDataV4(_structHash);
        signer = ecrecover(
            typedDataHash,
            _signature.v,
            _signature.r,
            _signature.s
        );

        if (signer == address(0)) {
            revert InvalidSignature();
        }
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal view override onlyAdmin {}

    /// @dev returns the manager of the contract
    function _getManager() internal view returns (PerpManager) {
        return PerpManager(owner());
    }
}
