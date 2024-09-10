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

    /// @dev Reinitializer for setting the new long and short pool addresses only once
    /// @param _longPool The long WasabiPerps pool
    /// @param _shortPool The short WasabiPerps pool
    function reinitialize(
        IWasabiPerps _longPool,
        IWasabiPerps _shortPool
    ) public virtual reinitializer(2) {
        longPool = _longPool;
        shortPool = _shortPool;
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
    function getPoolAddress() external pure returns (address) {
        revert Deprecated();
    }

    /// @inheritdoc IWasabiVaultV2
    function getPoolAddress(bool _long) external view returns (address) {
        return _long ? address(longPool) : address(shortPool);
    }

    /// @inheritdoc IWasabiVaultV2
    function getPoolAddresses() external view returns (address, address) {
        return (address(longPool), address(shortPool));
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
            _spendAllowance(owner, caller, shares);
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
}