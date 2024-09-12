// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./IWasabiVaultV2.sol";
import "../IWasabiPerps.sol";
import "../PerpUtils.sol";
import "../addressProvider/IAddressProvider.sol";
import "../weth/IWETH.sol";

contract WasabiVaultV2 is IWasabiVaultV2, UUPSUpgradeable, OwnableUpgradeable, ERC4626Upgradeable, ReentrancyGuardUpgradeable {
    using SafeERC20 for IERC20;

    address public _deprecated_pool;
    uint256 public totalAssetValue;
    IAddressProvider public addressProvider;
    IWasabiPerps public longPool;
    IWasabiPerps public shortPool;

    uint256 public constant LEVERAGE_DENOMINATOR = 100;

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
    /// @notice This function should only be called to initialize a new vault - for upgrading an existing vault use `reinitialize`
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
    ) public virtual reinitializer(2) {
        __Ownable_init(msg.sender);
        __ERC4626_init(_asset);
        __ERC20_init(name, symbol);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        addressProvider = _addressProvider;
        longPool = _longPool;
        shortPool = _shortPool;
    }

    /// @dev Reinitializer for setting the new long and short pool addresses only once
    /// @notice This function should only be called when upgrading an existing vault - for new vaults use `initialize`
    /// @param _longPool The WasabiLongPool contract
    /// @param _shortPool The WasabiShortPool contract
    /// @param _withdrawAmount The amount of assets to withdraw from the deprecated pool
    function reinitialize(
        IWasabiPerps _longPool,
        IWasabiPerps _shortPool,
        uint256 _withdrawAmount
    ) public virtual reinitializer(2) {
        longPool = _longPool;
        shortPool = _shortPool;
        if (_withdrawAmount == 0) {
            _withdrawAmount = IERC20(asset()).balanceOf(_deprecated_pool);
        }
        IWasabiPerps(_deprecated_pool).withdraw(asset(), _withdrawAmount, address(this));
        _deprecated_pool = address(0);
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
        return _deprecated_pool;
    }

    /// @inheritdoc IWasabiVaultV2
    function getPoolAddress(bool _long) external view returns (address) {
        return _long ? address(longPool) : address(shortPool);
    }

    /// @inheritdoc IWasabiVaultV2
    function getPoolAddresses() external view returns (address, address) {
        return (address(longPool), address(shortPool));
    }

    function checkMaxLeverage(uint256 _downPayment, uint256 _total) external view {
        if (_total * LEVERAGE_DENOMINATOR / _downPayment > _getDebtController().maxLeverage()) {
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
    function recordInterestEarned(uint256) external pure {
        revert Deprecated();
    }

    /// @inheritdoc IWasabiVault
    function recordLoss(uint256) external pure {
        revert Deprecated();
    }

    /// @inheritdoc IWasabiVaultV2
    function borrow(uint256 _amount) external onlyPool {
        // Validate principal
        IERC20 assetToken = IERC20(asset());
        uint256 balanceAvailableForLoan = assetToken.balanceOf(address(this));
        if (balanceAvailableForLoan < _amount) {
            // Wrap ETH if needed
            if (address(assetToken) == _getWethAddress() && address(this).balance > 0) {
                PerpUtils.wrapWETH(_getWethAddress());
                balanceAvailableForLoan = assetToken.balanceOf(address(this));

                if (balanceAvailableForLoan < _amount) revert InsufficientAvailablePrincipal();
            } else {
                revert InsufficientAvailablePrincipal();
            }
        }
        assetToken.safeTransfer(address(msg.sender), _amount);
    }

    /// @inheritdoc IWasabiVaultV2
    function repay(uint256 _amount, uint256 _interestEarned, uint256 _loss) external onlyPool {
        IERC20(asset()).safeTransferFrom(address(msg.sender), address(this), _amount);
        if (_interestEarned != 0) {
            totalAssetValue += _interestEarned;
        } else if (_loss != 0) {
            totalAssetValue -= _loss;
        }
    }

    /// @inheritdoc IWasabiVaultV2
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