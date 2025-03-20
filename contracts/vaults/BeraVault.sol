// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./WasabiVault.sol";
import "./IBeraVault.sol";
import "@berachain/pol-contracts/src/pol/interfaces/IRewardVault.sol";
import "@berachain/pol-contracts/src/pol/interfaces/IRewardVaultFactory.sol";

contract BeraVault is WasabiVault, IBeraVault {
    using SafeERC20 for IERC20;

    IRewardVault public rewardVault;

    uint256 public rewardFeeBips;

    mapping(address => uint256) private _rewardFeeUserBalance;

    IRewardVaultFactory public constant REWARD_VAULT_FACTORY = 
        IRewardVaultFactory(0x94Ad6Ac84f6C6FbA8b8CCbD71d9f4f101def52a8);

    /// @dev Initializer for proxy
    /// @notice This function should only be called to initialize a new vault
    /// @param _longPool The WasabiLongPool contract
    /// @param _shortPool The WasabiShortPool contract
    /// @param _addressProvider The address provider
    /// @param _manager The PerpManager contract that will own this vault
    /// @param _asset The asset
    /// @param name The name of the vault
    /// @param symbol The symbol of the vault
    function initialize(
        IWasabiPerps _longPool,
        IWasabiPerps _shortPool,
        IAddressProvider _addressProvider,
        PerpManager _manager,
        IERC20 _asset,
        string memory name,
        string memory symbol
    ) public override initializer {
        __ERC20_init(name, symbol);
        __Ownable_init(address(_manager));
        __ERC4626_init(_asset);
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        addressProvider = _addressProvider;
        longPool = _longPool;
        shortPool = _shortPool;
        rewardFeeBips = 500; // 5%

        rewardVault = IRewardVault(REWARD_VAULT_FACTORY.createRewardVault(address(this)));
        _approve(address(this), address(rewardVault), type(uint256).max);
    }

    /// @inheritdoc IERC20
    function balanceOf(address account) public view override(IERC20, ERC20Upgradeable) returns (uint256) {
        return rewardVault.balanceOf(account) + _rewardFeeUserBalance[account];
    }

    /// @inheritdoc IERC20
    function transfer(address to, uint256 value) public override(IERC20, ERC20Upgradeable) returns (bool) {
        if (msg.sender != address(rewardVault)) revert TransferNotSupported();
        return super.transfer(to, value);
    }

    /// @inheritdoc IERC20
    function transferFrom(
        address from,
        address to,
        uint256 value
    ) public override(IERC20, ERC20Upgradeable) returns (bool) {
        if (msg.sender != address(rewardVault)) revert TransferNotSupported();
        return super.transferFrom(from, to, value);
    }

    /// @inheritdoc WasabiVault
    /// @dev Actually BERA and WBERA, not ETH and WETH
    function depositEth(address receiver) public payable override(IWasabiVault, WasabiVault) returns (uint256) {
        address wberaAddress = addressProvider.getWethAddress();
        if (asset() != wberaAddress) revert CannotDepositEth();

        uint256 assets = msg.value;
        if (assets == 0) revert InvalidEthAmount();

        uint256 maxAssets = maxDeposit(receiver);
        if (assets > maxAssets) {
            revert ERC4626ExceededMaxDeposit(receiver, assets, maxAssets);
        }

        uint256 shares = previewDeposit(assets);

        IWETH(wberaAddress).deposit{value: assets}();

        // Mint shares to this contract and stake them in the reward vault on the user's behalf
        // except for a portion of the shares that will accrue the reward fee to the vault
        _mint(address(this), shares);
        uint256 rewardFee = (shares * rewardFeeBips) / 10000;
        rewardVault.delegateStake(receiver, shares - rewardFee);
        if (rewardFee != 0) {
            rewardVault.stake(rewardFee);
            _rewardFeeUserBalance[receiver] += rewardFee;
        }
        
        totalAssetValue += assets;
        emit Deposit(msg.sender, receiver, assets, shares);

        return shares;
    }

    /// @inheritdoc IBeraVault
    function claimBGTReward(address _receiver) external onlyAdmin returns (uint256) {
        return rewardVault.getReward(address(this), _receiver);
    }

    /// @inheritdoc IBeraVault
    function setRewardFeeBips(uint256 _rewardFeeBips) external onlyAdmin {
        if (_rewardFeeBips > 10000) revert InvalidFeeBips();
        rewardFeeBips = _rewardFeeBips;
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

        // Mint shares to this contract and stake them in the reward vault on the user's behalf
        // except for a portion of the shares that will accrue the reward fee to the vault
        _mint(address(this), shares);
        uint256 rewardFee = (shares * rewardFeeBips) / 10000;
        rewardVault.delegateStake(receiver, shares - rewardFee);
        if (rewardFee != 0) {
            rewardVault.stake(rewardFee);
            _rewardFeeUserBalance[receiver] += rewardFee;
        }

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

        // Determine the portion of shares to withdraw with delegateWithdraw vs withdraw
        // i.e., if user has 100 shares, 10 of which are fee shares, and they want to withdraw 20 shares total,
        // we should withdraw 20% of the delegated stake and 20% of the fee stake, or 18 and 2 shares respectively
        uint256 ownerBalance = balanceOf(owner);
        uint256 totalDelegatedStake = ownerBalance - _rewardFeeUserBalance[owner];
        uint256 delegateWithdrawAmount = (totalDelegatedStake * shares) / ownerBalance;
        uint256 feeWithdrawAmount = shares - delegateWithdrawAmount;

        // Withdraw shares from the reward vault on the user's behalf and burn
        rewardVault.delegateWithdraw(owner, delegateWithdrawAmount);
        if (feeWithdrawAmount != 0) {
            rewardVault.withdraw(feeWithdrawAmount);
            _rewardFeeUserBalance[owner] -= feeWithdrawAmount;
        }
        _burn(address(this), shares);

        totalAssetValue -= assets;

        if (totalSupply() == 0) {
            // Clean dust if no shares are left
            assets += totalAssetValue;
            totalAssetValue = 0;
        }

        IERC20(asset()).safeTransfer(receiver, assets);

        // Claim rewards for the user if this contract is set as their operator
        if (rewardVault.operator(receiver) == address(this)) {
            rewardVault.getReward(receiver, receiver);
        }

        emit Withdraw(caller, receiver, owner, assets, shares);
    }
}