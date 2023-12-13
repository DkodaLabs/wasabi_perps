// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../IWasabiPerps.sol";
import "./IWasabiVault.sol";
import "../addressProvider/IAddressProvider.sol";
import "../weth/IWETH.sol";

contract WasabiVault is IWasabiVault, UUPSUpgradeable, OwnableUpgradeable, ERC4626Upgradeable, ReentrancyGuardUpgradeable {
    IWasabiPerps public pool;
    uint256 public totalAssetValue;
    IAddressProvider public addressProvider;

    function initialize(
        IWasabiPerps _pool,
        IAddressProvider _addressProvider,
        IERC20 _asset,
        string memory name,
        string memory symbol
    ) public initializer {
        __Ownable_init(msg.sender);
        __ERC4626_init(_asset);
        __ERC20_init(name, symbol);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        pool = _pool;
        addressProvider = _addressProvider;
        totalAssetValue = 0;
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @inheritdoc ERC4626Upgradeable
    function totalAssets() public view override returns (uint256) {
        return totalAssetValue;
    }

    /** @dev See {IERC4626-deposit}. */
    function depositEth(address receiver) public payable returns (uint256) {
        if (asset() != addressProvider.getWethAddress()) revert CannotDepositEth();

        uint256 assets = msg.value;
        if (assets == 0) revert InvalidEthAmount();

        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) {
            revert ERC4626ExceededMaxDeposit(receiver, assets, maxAssets);
        }

        uint256 shares = previewDeposit(assets);

        IWETH weth = IWETH(addressProvider.getWethAddress());
        weth.deposit{value: assets}();
        SafeERC20.safeTransfer(weth, address(pool), assets);

        _mint(receiver, shares);
        totalAssetValue += assets;
        emit Deposit(_msgSender(), receiver, assets, shares);

        return shares;
    }

    /// @inheritdoc ERC4626Upgradeable
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal virtual override {
        SafeERC20.safeTransferFrom(IERC20(asset()), caller, address(pool), assets);

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
    ) internal virtual override {
        if (caller != owner) {
            _spendAllowance(owner, caller, shares);
        }

        _burn(owner, shares);
        pool.withdraw(asset(), assets, receiver);

        totalAssetValue -= assets;

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    /// @inheritdoc IWasabiVault
    function getAsset() external view override returns (address) {
        return asset();
    }

    /// @inheritdoc IWasabiVault
    function getPoolAddress() external view override returns (address) {
        return address(pool);
    }

    /// @inheritdoc IWasabiVault
    function recordInterestEarned(uint256 _interestAmount) external override {
        if (address(pool) != _msgSender()) revert CallerNotPool();

        if (_interestAmount > 0) {
            totalAssetValue += _interestAmount;
        }
    }

    /// @inheritdoc IWasabiVault
    function recordLoss(uint256 _amountLost) external override {
        if (address(pool) != _msgSender()) revert CallerNotPool();

        totalAssetValue -= _amountLost;
    }

    /// @dev Pays ETH to a given address
    /// @param _amount The amount to pay
    /// @param _target The address to pay to
    function payETH(uint256 _amount, address _target) internal {
        if (_amount > 0) {
            (bool sent, ) = payable(_target).call{value: _amount}("");
            if (!sent) {
                revert EthTransferFailed();
            }
        }
    }
}
