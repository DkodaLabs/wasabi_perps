// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IWasabiACPAccount} from "./IWasabiACPAccount.sol";
import {IWasabiPerps} from "../IWasabiPerps.sol";
import {IWasabiVault} from "../vaults/IWasabiVault.sol";

contract WasabiACPAccount is IWasabiACPAccount, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    address public accountFactory;
    address public wasabiAgent;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                         MODIFIERS                          */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @dev Checks if the caller is the account factory
    modifier onlyOwnerOrAgent() {
        if (msg.sender != owner() && msg.sender != wasabiAgent) revert CallerNotOwnerOrAgent();
        _;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        INITIALIZER                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the account
    /// @param _accountHolder The account holder's address
    /// @param _wasabiAgent The Wasabi agent's wallet address
    function initialize(address _accountHolder, address _wasabiAgent) external initializer {
        __Ownable_init(_accountHolder);
        __ReentrancyGuard_init();
        accountFactory = msg.sender;
        wasabiAgent = _wasabiAgent;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      TRADING FUNCTIONS                     */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IWasabiACPAccount
    function withdrawFunds(
        address _token,
        uint256 _amount
    ) external onlyOwnerOrAgent nonReentrant {
        IERC20(_token).safeTransfer(msg.sender, _amount);
    }

    /// @inheritdoc IWasabiACPAccount
    function openPosition(
        IWasabiPerps _pool,
        IWasabiPerps.OpenPositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature
    ) external onlyOwnerOrAgent nonReentrant {
        bool isLongPool = _pool.isLongPool();
        address paymentCurrency = isLongPool ? _request.currency : _request.targetCurrency;
        uint256 paymentAmount = _request.downPayment + _request.fee;

        IERC20(paymentCurrency).forceApprove(address(_pool), paymentAmount);

        _pool.openPosition(_request, _signature);
    }

    /// @inheritdoc IWasabiACPAccount
    function closePosition(
        IWasabiPerps _pool,
        IWasabiPerps.PayoutType _payoutType,
        IWasabiPerps.ClosePositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature
    ) external onlyOwnerOrAgent nonReentrant {
        _pool.closePosition(_payoutType, _request, _signature);

        bool isLongPool = _pool.isLongPool();
        address payoutCurrency = isLongPool ? _request.position.currency : _request.position.collateralCurrency;
        uint256 payout = IERC20(payoutCurrency).balanceOf(address(this));

        IERC20(payoutCurrency).safeTransfer(owner(), payout);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      EARNING FUNCTIONS                     */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IWasabiACPAccount
    function depositToVault(
        IWasabiVault _vault,
        uint256 _amount
    ) external onlyOwnerOrAgent nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        
        IERC20(_vault.asset()).forceApprove(address(_vault), _amount);

        _vault.deposit(_amount, address(this));
    }

    /// @inheritdoc IWasabiACPAccount
    function withdrawFromVault(
        IWasabiVault _vault,
        uint256 _amount
    ) external onlyOwnerOrAgent nonReentrant {
        uint256 maxWithdraw = _vault.maxWithdraw(address(this));
        if (_amount > maxWithdraw) revert InvalidAmount();
        if (_amount == 0) {
            _amount = maxWithdraw;
        }

        _vault.withdraw(_amount, owner(), address(this));
    }
}