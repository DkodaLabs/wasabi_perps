// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/manager/AccessManagerUpgradeable.sol";

import "./IPerpManager.sol";
import "../addressProvider/IAddressProvider.sol";
import "../debt/IDebtController.sol";
import "../vaults/IWasabiVault.sol";
import "../router/IWasabiRouter.sol";

contract PerpManager is UUPSUpgradeable, AccessManagerUpgradeable, IPerpManager, IAddressProvider, IDebtController {
    uint256 public constant LEVERAGE_DENOMINATOR = 100;
    uint256 public constant APY_DENOMINATOR = 100;

    mapping(address trader => mapping(address signer => bool isAuthorized)) private _isAuthorizedSigner;

    IWasabiRouter public wasabiRouter;
    address public feeReceiver;
    address public wethAddress;
    address public liquidationFeeReceiver;
    address public stakingAccountFactory;
    IPartnerFeeManager public partnerFeeManager;
    uint256 public maxApy; // 300% APR will be 300
    uint256 public maxLeverage; // e.g. 3x leverage = 300
    uint256 public liquidationFeeBps;

    modifier onlyAdmin() {
        isAdmin(msg.sender);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev initializer for proxy
    function initialize(
        IWasabiRouter _wasabiRouter,
        address _feeReceiver,
        address _wethAddress,
        address _liquidationFeeReceiver,
        address _stakingAccountFactory,
        IPartnerFeeManager _partnerFeeManager,
        uint256 _maxApy,
        uint256 _maxLeverage
    ) public virtual initializer {
        __AccessManager_init(msg.sender);
        wasabiRouter = _wasabiRouter;
        feeReceiver = _feeReceiver;
        wethAddress = _wethAddress;
        liquidationFeeReceiver = _liquidationFeeReceiver;
        stakingAccountFactory = _stakingAccountFactory;
        partnerFeeManager = _partnerFeeManager;
        maxApy = _maxApy;
        maxLeverage = _maxLeverage;
        liquidationFeeBps = 500; // 5%
    }

    function migrate(
        address _feeReceiver,
        address _wethAddress,
        address _liquidationFeeReceiver,
        address _stakingAccountFactory,
        IPartnerFeeManager _partnerFeeManager,
        uint256 _maxApy,
        uint256 _maxLeverage
    ) external onlyAdmin {
        if (wethAddress != address(0)) revert AlreadyMigrated();
        feeReceiver = _feeReceiver;
        wethAddress = _wethAddress;
        liquidationFeeReceiver = _liquidationFeeReceiver;
        stakingAccountFactory = _stakingAccountFactory;
        partnerFeeManager = _partnerFeeManager;
        maxApy = _maxApy;
        maxLeverage = _maxLeverage;
        liquidationFeeBps = 500; // 5%
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal view override onlyAdmin {}

    /// @inheritdoc IPerpManager
    function isAdmin(address account) public view {
        checkRole(ADMIN_ROLE, account);
    }

    /// @inheritdoc IPerpManager
    function checkRole(uint64 roleId, address account) public view {
        (bool hasRole, ) = hasRole(roleId, account);
        if (!hasRole) revert AccessManagerUnauthorizedAccount(account, roleId);
    }

    /// @inheritdoc IAddressProvider
    function getWasabiRouter()
        external
        view
        override
        returns (IWasabiRouter)
    {
        return wasabiRouter;
    }

    /// @inheritdoc IAddressProvider
    function getFeeReceiver()
        external
        view
        override
        returns (address)
    {
        return feeReceiver;
    }

    /// @inheritdoc IAddressProvider
    function getLiquidationFeeReceiver()
        external
        view
        override
        returns (address)
    {
        return liquidationFeeReceiver;
    }

    /// @inheritdoc IAddressProvider
    function getWethAddress() external view returns (address) {
        return wethAddress;
    }

    /// @inheritdoc IAddressProvider
    function getStakingAccountFactory() external view returns (address) {
        return stakingAccountFactory;
    }

    /// @inheritdoc IAddressProvider
    function getPartnerFeeManager() external view returns (IPartnerFeeManager) {
        return partnerFeeManager;
    }

    /// @inheritdoc IDebtController
    function computeMaxInterest(
        address,
        uint256 _principal,
        uint256 _lastFundingTimestamp
    ) public view returns(uint256 maxInterestToPay) {
        uint256 secondsSince = block.timestamp - _lastFundingTimestamp;
        maxInterestToPay = _principal * maxApy * secondsSince / (APY_DENOMINATOR * (365 days));
    }

    /// @inheritdoc IDebtController
    function computeMaxPrincipal(
        address,
        address,
        uint256 _downPayment
    ) external view returns (uint256 maxPrincipal) {
        maxPrincipal = _downPayment * (maxLeverage - LEVERAGE_DENOMINATOR) / LEVERAGE_DENOMINATOR;
    }

    /// @inheritdoc IDebtController
    function getLiquidationFeeBps(address, address) external view returns (uint256) {
        return liquidationFeeBps;
    }

    /// @inheritdoc IDebtController
    function getLiquidationFee(uint256 _downPayment, address, address) external view returns (uint256) {
        return (_downPayment * liquidationFeeBps) / 10000;
    }

    /// @inheritdoc IPerpManager
    function isAuthorizedSigner(address trader, address signer) public view returns (bool) {
        return _isAuthorizedSigner[trader][signer];
    }

    /// @dev sets the Wasabi router
    /// @param _wasabiRouter the Wasabi router
    function setWasabiRouter(IWasabiRouter _wasabiRouter) external onlyAdmin {
        wasabiRouter = _wasabiRouter;
    }

    /// @dev sets the fee controller
    /// @param _feeReceiver the fee receiver
    function setFeeReceiver(address _feeReceiver) external onlyAdmin {
        if (_feeReceiver == address(0)) revert InvalidAddress();
        feeReceiver = _feeReceiver;
    }

    /// @dev sets the fee controller
    /// @param _liquidationFeeReceiver the fee receiver
    function setLiquidationFeeReceiver(address _liquidationFeeReceiver) external onlyAdmin {
        if (_liquidationFeeReceiver == address(0)) revert InvalidAddress();
        liquidationFeeReceiver = _liquidationFeeReceiver;
    }

    /// @dev sets the staking account factory
    /// @param _stakingAccountFactory the staking account factory
    function setStakingAccountFactory(address _stakingAccountFactory) external onlyAdmin {
        if (_stakingAccountFactory == address(0)) revert InvalidAddress();
        stakingAccountFactory = _stakingAccountFactory;
    }

    /// @dev sets the partner fee manager
    /// @param _partnerFeeManager the partner fee manager
    function setPartnerFeeManager(address _partnerFeeManager) external onlyAdmin {
        if (_partnerFeeManager == address(0)) revert InvalidAddress();
        partnerFeeManager = IPartnerFeeManager(_partnerFeeManager);
    }

    /// @dev sets the maximum leverage
    /// @param _maxLeverage the max leverage 
    function setMaxLeverage(uint256 _maxLeverage) external onlyAdmin {
        if (_maxLeverage == 0) revert InvalidValue();
        if (_maxLeverage > 100 * LEVERAGE_DENOMINATOR) revert InvalidValue(); // 100x leverage
        maxLeverage = _maxLeverage;
    }

    /// @dev sets the maximum apy
    /// @param _maxApy the max APY 
    function setMaxAPY(uint256 _maxApy) external onlyAdmin {
        if (_maxApy == 0) revert InvalidValue();
        if (_maxApy > 1000 * APY_DENOMINATOR) revert InvalidValue(); // 1000% APR
        maxApy = _maxApy;
    }

    /// @dev sets the liquidation fee bps
    /// @param _liquidationFeeBps the liquidation fee bps
    function setLiquidationFeeBps(uint256 _liquidationFeeBps) external onlyAdmin {
        if (_liquidationFeeBps == 0) revert InvalidValue();
        if (_liquidationFeeBps > 1000) revert InvalidValue(); // 10%
        liquidationFeeBps = _liquidationFeeBps;
    }

    /// @inheritdoc IPerpManager
    function setAuthorizedSigner(address signer, bool isAuthorized) public {
        _isAuthorizedSigner[msg.sender][signer] = isAuthorized;
        emit AuthorizedSignerChanged(msg.sender, signer, isAuthorized);
    }
}