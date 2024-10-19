// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./IWasabiVault.sol";
import "../IWasabiPerps.sol";
import "../PerpUtils.sol";
import "../addressProvider/IAddressProvider.sol";
import "../weth/IWETH.sol";

contract WasabiVault is IWasabiVault, UUPSUpgradeable, OwnableUpgradeable, ERC4626Upgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    /// @custom:oz-renamed-from pool
    IWasabiPerps public _deprecated_pool;
    uint256 public totalAssetValue;
    IAddressProvider public addressProvider;
    IWasabiPerps public longPool;
    IWasabiPerps public shortPool;

    uint256 private constant LEVERAGE_DENOMINATOR = 100;

    modifier onlyPool() {
        if (msg.sender != address(shortPool)) {
            // Nested checks save a little gas compared to using &&
            if (msg.sender != address(longPool)) revert CallerNotPool();
        }
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Initializer for proxy
    /// @notice This function should only be called to initialize a new vault - for upgrading an existing vault use `migrate`
    /// @param _longPool The WasabiLongPool contract
    /// @param _shortPool The WasabiShortPool contract
    /// @param _addressProvider The address provider
    /// @param _asset The asset
    /// @param name The name of the vault
    /// @param symbol The symbol of the vault
    function initialize(
        IWasabiPerps _longPool,
        IWasabiPerps _shortPool,
        IAddressProvider _addressProvider,
        IERC20 _asset,
        string memory name,
        string memory symbol
    ) public virtual initializer {
        __Ownable_init(msg.sender);
        __ERC4626_init(_asset);
        __ERC20_init(name, symbol);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        addressProvider = _addressProvider;
        longPool = _longPool;
        shortPool = _shortPool;
    }

    /// @dev Sets the new pool variables and migrates assets from the original pool only once
    /// @notice This function should only be called when upgrading an existing vault - for new vaults use `initialize`
    /// @param _longPool The WasabiLongPool contract
    /// @param _shortPool The WasabiShortPool contract
    /// @param _addressProvider The new AddressProvider contract
    /// @param _feesToKeep The amount of assets to leave in the deprecated pool for outstanding fees
    function migrate(
        IWasabiPerps _longPool,
        IWasabiPerps _shortPool,
        IAddressProvider _addressProvider,
        uint256 _feesToKeep
    ) public virtual onlyOwner {
        if (address(_deprecated_pool) == address(0)) {
            revert AlreadyMigrated();
        }
        longPool = _longPool;
        shortPool = _shortPool;
        addressProvider = _addressProvider;
        uint256 withdrawAmount = IERC20(asset()).balanceOf(address(_deprecated_pool)) - _feesToKeep;
        _deprecated_pool.withdraw(asset(), withdrawAmount, address(this));
        _deprecated_pool = IWasabiPerps(address(0));
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @inheritdoc ERC4626Upgradeable
    function totalAssets() public view override(ERC4626Upgradeable, IERC4626) returns (uint256) {
        return totalAssetValue;
    }

    /// @inheritdoc IWasabiVault
    /// @notice Deprecated
    function getPoolAddress() external view returns (address) {
        return address(_deprecated_pool);
    }

    /// @inheritdoc IWasabiVault
    function getPoolAddress(bool _long) external view returns (address) {
        return _long ? address(longPool) : address(shortPool);
    }

    /// @inheritdoc IWasabiVault
    function checkMaxLeverage(uint256 _downPayment, uint256 _total) external view {
        if (_total * LEVERAGE_DENOMINATOR > _getDebtController().maxLeverage() * _downPayment) {
            revert PrincipalTooHigh();
        }
    }

    /** @dev See {IERC4626-deposit}. */
    function depositEth(address receiver) public payable nonReentrant returns (uint256) {
        address wethAddress = addressProvider.getWethAddress();
        if (asset() != wethAddress) revert CannotDepositEth();

        uint256 assets = msg.value;
        if (assets == 0) revert InvalidEthAmount();

        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) {
            revert ERC4626ExceededMaxDeposit(receiver, assets, maxAssets);
        }

        uint256 shares = previewDeposit(assets);

        IWETH(wethAddress).deposit{value: assets}();

        _mint(receiver, shares);
        totalAssetValue += assets;
        emit Deposit(msg.sender, receiver, assets, shares);

        return shares;
    }

    /// @inheritdoc IWasabiVault
    /// @notice Deprecated
    function recordInterestEarned(uint256) external pure {
        revert Deprecated();
    }

    /// @inheritdoc IWasabiVault
    /// @notice Deprecated
    function recordLoss(uint256) external pure {
        revert Deprecated();
    }

    /// @inheritdoc IWasabiVault
    function borrow(uint256 _amount) external onlyPool {
        // Validate principal
        IERC20 assetToken = IERC20(asset());
        if (assetToken.balanceOf(address(this)) < _amount) {
            revert InsufficientAvailablePrincipal();
        }
        assetToken.safeTransfer(msg.sender, _amount);
    }

    /// @inheritdoc IWasabiVault
    function recordRepayment(uint256 _totalRepaid, uint256 _principal, bool _isLiquidation) external onlyPool {
        if (_totalRepaid < _principal) {
            // Only liquidations can cause bad debt
            if (!_isLiquidation) revert InsufficientPrincipalRepaid();
            uint256 loss = _principal - _totalRepaid;
            totalAssetValue -= loss;
        } else {
            uint256 interestPaid = _totalRepaid - _principal;
            totalAssetValue += interestPaid;
        }
    }

    /// @inheritdoc IWasabiVault
    function donate(uint256 _amount) external onlyOwner {
        if (_amount == 0) revert InvalidAmount();
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), _amount);
        totalAssetValue += _amount;
        emit NativeYieldClaimed(asset(), _amount);
    }

    /// @inheritdoc ERC4626Upgradeable
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal virtual override nonReentrant {
        if (assets == 0 || shares == 0) revert InvalidAmount();

        IERC20(asset()).safeTransferFrom(caller, address(this), assets);

        _mint(receiver, shares);
        totalAssetValue += assets;
        emit Deposit(caller, receiver, assets, shares);
    }

    /// @inheritdoc ERC4626Upgradeable
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal virtual override nonReentrant {
        if (assets == 0 || shares == 0) revert InvalidAmount();

        if (caller != owner) {
            if (caller != address(addressProvider.getWasabiRouter())) {
                _spendAllowance(owner, caller, shares);
            }
        }

        _burn(owner, shares);

        totalAssetValue -= assets;

        IERC20(asset()).safeTransfer(receiver, assets);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    /// @dev returns the WETH address
    function _getWethAddress() internal view returns (address) {
        return addressProvider.getWethAddress();
    }

    /// @dev returns the debt controller
    function _getDebtController() internal view returns (IDebtController) {
        return addressProvider.getDebtController();
    }
}