// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/manager/AccessManagerUpgradeable.sol";

import "./IPerpManager.sol";
import "./Roles.sol";
import "../addressProvider/IAddressProvider.sol";
import "../debt/IDebtController.sol";
import "../vaults/IWasabiVault.sol";
import "../router/IWasabiRouter.sol";

contract PerpManager is UUPSUpgradeable, AccessManagerUpgradeable, IPerpManager, IAddressProvider, IDebtController {
    uint256 public constant LEVERAGE_DENOMINATOR = 100;
    uint256 public constant APY_DENOMINATOR = 100;
    uint256 public constant LIQUIDATION_THRESHOLD_DENOMINATOR = 10000;
    uint256 public constant DEFAULT_LIQUIDATION_THRESHOLD_BPS = 500; // 5%

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                       State Variables                      */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/
    
    mapping(address trader => mapping(address signer => bool isAuthorized)) private _isAuthorizedSigner;
    mapping(address token0 => mapping(address token1 => uint256 liquidationThresholdBps)) private _liquidationThreshold;

    // IAddressProvider state
    /// @inheritdoc IAddressProvider
    IWasabiRouter public wasabiRouter;
    /// @inheritdoc IAddressProvider
    address public feeReceiver;
    /// @inheritdoc IAddressProvider
    address public wethAddress;
    /// @inheritdoc IAddressProvider
    address public liquidationFeeReceiver;
    /// @inheritdoc IAddressProvider
    address public stakingAccountFactory;
    /// @inheritdoc IAddressProvider
    IPartnerFeeManager public partnerFeeManager;

    // IDebtController state
    /// @inheritdoc IDebtController
    uint256 public maxApy;
    /// @inheritdoc IDebtController
    uint256 public maxLeverage;
    /// @inheritdoc IDebtController
    uint256 public liquidationFeeBps;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                         Modifiers                          */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    modifier onlyAdmin() {
        isAdmin(msg.sender);
        _;
    }

    modifier onlyVaultAdmin() {
        checkRole(Roles.VAULT_ADMIN_ROLE, msg.sender);
        _;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                       Initialization                       */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Initializer for proxy
    /// @param _wasabiRouter The WasabiRouter contract
    /// @param _feeReceiver The fee receiver address
    /// @param _wethAddress The WETH address
    /// @param _liquidationFeeReceiver The liquidation fee receiver address
    /// @param _stakingAccountFactory The StakingAccountFactory contract
    /// @param _partnerFeeManager The PartnerFeeManager contract
    /// @param _maxApy The maximum APY
    /// @param _maxLeverage The maximum leverage
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
        __PerpManager_init(_wasabiRouter, _feeReceiver, _wethAddress, _liquidationFeeReceiver, _stakingAccountFactory, _partnerFeeManager, _maxApy, _maxLeverage);
    }

    function __PerpManager_init(
        IWasabiRouter _wasabiRouter,
        address _feeReceiver,
        address _wethAddress,
        address _liquidationFeeReceiver,
        address _stakingAccountFactory,
        IPartnerFeeManager _partnerFeeManager,
        uint256 _maxApy,
        uint256 _maxLeverage
    ) internal onlyInitializing {
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

    /// @dev Migrate the contract with new state variables from AddressProvider and DebtController
    /// @notice Use this instead of initialize if upgrading the existing PerpManager contract rather than deploying a new one
    /// @param _wasabiRouter The WasabiRouter contract
    /// @param _feeReceiver The fee receiver address
    /// @param _wethAddress The WETH address
    /// @param _liquidationFeeReceiver The liquidation fee receiver address
    /// @param _stakingAccountFactory The StakingAccountFactory contract
    /// @param _partnerFeeManager The PartnerFeeManager contract
    /// @param _maxApy The maximum APY
    /// @param _maxLeverage The maximum leverage
    function migrate(
        IWasabiRouter _wasabiRouter,
        address _feeReceiver,
        address _wethAddress,
        address _liquidationFeeReceiver,
        address _stakingAccountFactory,
        IPartnerFeeManager _partnerFeeManager,
        uint256 _maxApy,
        uint256 _maxLeverage
    ) external onlyAdmin {
        if (wethAddress != address(0)) revert AlreadyMigrated();
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

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                     IPerpManager Views                     */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IPerpManager
    function isAdmin(address account) public view {
        checkRole(ADMIN_ROLE, account);
    }

    /// @inheritdoc IPerpManager
    function checkRole(uint64 roleId, address account) public view {
        (bool hasRole, ) = hasRole(roleId, account);
        if (!hasRole) revert AccessManagerUnauthorizedAccount(account, roleId);
    }

    /// @inheritdoc IPerpManager
    function isAuthorizedSigner(address trader, address signer) public view returns (bool) {
        return _isAuthorizedSigner[trader][signer];
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                    IDebtController Views                   */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

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
    function getLiquidationFee(uint256 _downPayment, address, address) external view returns (uint256) {
        return (_downPayment * liquidationFeeBps) / 10000;
    }

    /// @inheritdoc IDebtController
    function getLiquidationThresholdBps(address _tokenA, address _tokenB) public view returns (uint256) {
        (address token0, address token1) = _sortTokens(_tokenA, _tokenB);
        uint256 liquidationThresholdBps = _liquidationThreshold[token0][token1];
        if (liquidationThresholdBps == 0) {
            liquidationThresholdBps = DEFAULT_LIQUIDATION_THRESHOLD_BPS;
        }
        return liquidationThresholdBps;
    }

    /// @inheritdoc IDebtController
    function getLiquidationThreshold(address _tokenA, address _tokenB, uint256 _size) external view returns (uint256) {
        uint256 liquidationThresholdBps = getLiquidationThresholdBps(_tokenA, _tokenB);
        return _size * liquidationThresholdBps / LIQUIDATION_THRESHOLD_DENOMINATOR;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                     IPerpManager Writes                    */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IPerpManager
    function setAuthorizedSigner(address signer, bool isAuthorized) public {
        _isAuthorizedSigner[msg.sender][signer] = isAuthorized;
        emit AuthorizedSignerChanged(msg.sender, signer, isAuthorized);
    }

    /// @inheritdoc IPerpManager
    function deployVault(address implementation, bytes calldata data) external onlyVaultAdmin returns (address) {
        address vault = address(new ERC1967Proxy(implementation, data));
        wasabiRouter.shortPool().addVault(IWasabiVault(vault));
        return vault;
    }

    /// @inheritdoc IPerpManager
    function upgradeVaults(address newImplementation, address[] calldata vaults, bytes[] calldata calls) external onlyAdmin {
        uint256 vaultsLength = vaults.length;
        if (vaultsLength != calls.length && calls.length != 0) revert InvalidLength();
        for (uint256 i; i < vaultsLength; ) {
            UUPSUpgradeable(vaults[i]).upgradeToAndCall(newImplementation, calls.length != 0 ? calls[i] : bytes(""));
            unchecked {
                ++i;
            }
        }
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                   IAddressProvider Writes                  */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IAddressProvider
    function setWasabiRouter(IWasabiRouter _wasabiRouter) external onlyAdmin {
        wasabiRouter = _wasabiRouter;
    }

    /// @inheritdoc IAddressProvider
    function setFeeReceiver(address _feeReceiver) external onlyAdmin {
        if (_feeReceiver == address(0)) revert InvalidAddress();
        feeReceiver = _feeReceiver;
    }

    /// @inheritdoc IAddressProvider
    function setLiquidationFeeReceiver(address _liquidationFeeReceiver) external onlyAdmin {
        if (_liquidationFeeReceiver == address(0)) revert InvalidAddress();
        liquidationFeeReceiver = _liquidationFeeReceiver;
    }

    /// @inheritdoc IAddressProvider
    function setStakingAccountFactory(address _stakingAccountFactory) external onlyAdmin {
        if (_stakingAccountFactory == address(0)) revert InvalidAddress();
        stakingAccountFactory = _stakingAccountFactory;
    }

    /// @inheritdoc IAddressProvider
    function setPartnerFeeManager(address _partnerFeeManager) external onlyAdmin {
        if (_partnerFeeManager == address(0)) revert InvalidAddress();
        partnerFeeManager = IPartnerFeeManager(_partnerFeeManager);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                   IDebtController Writes                   */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IDebtController
    function setMaxLeverage(uint256 _maxLeverage) external onlyAdmin {
        if (_maxLeverage == 0) revert InvalidValue();
        if (_maxLeverage > 100 * LEVERAGE_DENOMINATOR) revert InvalidValue(); // 100x leverage
        maxLeverage = _maxLeverage;
    }

    /// @inheritdoc IDebtController
    function setMaxAPY(uint256 _maxApy) external onlyAdmin {
        if (_maxApy == 0) revert InvalidValue();
        if (_maxApy > 1000 * APY_DENOMINATOR) revert InvalidValue(); // 1000% APR
        maxApy = _maxApy;
    }

    /// @inheritdoc IDebtController
    function setLiquidationFeeBps(uint256 _liquidationFeeBps) external onlyAdmin {
        if (_liquidationFeeBps == 0) revert InvalidValue();
        if (_liquidationFeeBps > 1000) revert InvalidValue(); // 10%
        liquidationFeeBps = _liquidationFeeBps;
    }

    /// @inheritdoc IDebtController
    function setLiquidationThresholdBps(address _tokenA, address _tokenB, uint256 _liquidationThresholdBps) external onlyAdmin {
        if (_liquidationThresholdBps == 0) revert InvalidValue();
        if (_liquidationThresholdBps > LIQUIDATION_THRESHOLD_DENOMINATOR) revert InvalidValue(); // 100%
        (address token0, address token1) = _sortTokens(_tokenA, _tokenB);
        _liquidationThreshold[token0][token1] = _liquidationThresholdBps;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                     Internal Functions                     */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal view override onlyAdmin {}

    /// @dev Sorts two token addresses Uniswap style
    function _sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (token0, token1) = uint160(tokenA) < uint160(tokenB)
            ? (tokenA, tokenB)
            : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
    }
}