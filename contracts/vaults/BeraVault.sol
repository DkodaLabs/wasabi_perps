// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "./WasabiVault.sol";
import "./IBeraVault.sol";
import "@berachain/pol-contracts/src/pol/interfaces/IRewardVault.sol";
import "@berachain/pol-contracts/src/pol/interfaces/IRewardVaultFactory.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

contract BeraVault is WasabiVault, IBeraVault {
    using SafeERC20 for IERC20;
    using Math for uint256;

    /// @custom:oz-renamed-from rewardVault
    IRewardVault public _rewardVaultDeprecated;

    struct RewardStorage {
        IRewardVault rewardVault;
        uint256 rewardFeeBips;
        mapping(address => uint256) rewardFeeUserBalance;
    }

    // @notice The slot where the RewardStorage struct is stored
    // @dev This equals bytes32(uint256(keccak256("wasabi.vault.reward_storage")) - 1)
    bytes32 private constant REWARD_STORAGE_SLOT = 0x3a98d39551c291449e156f1efe80f323dad9e74efefffe75144eae654edcfd08;

    IRewardVaultFactory public constant REWARD_VAULT_FACTORY = 
        IRewardVaultFactory(0x94Ad6Ac84f6C6FbA8b8CCbD71d9f4f101def52a8);

    uint256 private constant HUNDRED_PERCENT = 10000;

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

        RewardStorage storage rs = _getRewardStorage();
        rs.rewardVault = IRewardVault(REWARD_VAULT_FACTORY.createRewardVault(address(this)));
        rs.rewardFeeBips = 1000; // 10%

        _approve(address(this), address(rs.rewardVault), type(uint256).max);
    }

    /// @inheritdoc IBeraVault
    function migrateFees(address[] calldata accounts, bool isAllBalances) external onlyAdmin {
        uint256 numAccounts = accounts.length;
        uint256 balanceSum;
        RewardStorage storage rs = _getRewardStorage();
        if (address(_rewardVaultDeprecated) != address(0)) {
            rs.rewardVault = _rewardVaultDeprecated;
            delete _rewardVaultDeprecated;
        }
        uint256 rewardFeeBips = rs.rewardFeeBips;
        IRewardVault rewardVault = rs.rewardVault;
        for (uint256 i; i < numAccounts; ) {
            address account = accounts[i];
            uint256 balance = balanceOf(account);
            if (isAllBalances) {
                balanceSum += balance;
            }
            if (rs.rewardFeeUserBalance[account] == 0) {
                uint256 rewardFee = balance.mulDiv(rewardFeeBips, HUNDRED_PERCENT, Math.Rounding.Floor);
                if (rewardFee != 0) {
                    rewardVault.delegateWithdraw(account, rewardFee);
                    rewardVault.stake(rewardFee);
                    rs.rewardFeeUserBalance[account] = rewardFee;
                }
            }
            unchecked {
                ++i;
            }
        }
        if (isAllBalances && balanceSum != totalSupply()) {
            revert AllBalancesNotMigrated();
        }
    }

    /// @inheritdoc IERC20
    function balanceOf(address account) public view override(IERC20, ERC20Upgradeable) returns (uint256) {
        RewardStorage storage rs = _getRewardStorage();
        return rs.rewardVault.balanceOf(account) + rs.rewardFeeUserBalance[account];
    }

    /// @inheritdoc IERC20
    function transfer(address to, uint256 value) public override(IERC20, ERC20Upgradeable) returns (bool) {
        if (msg.sender != address(getRewardVault())) revert TransferNotSupported();
        return super.transfer(to, value);
    }

    /// @inheritdoc IERC20
    function transferFrom(
        address from,
        address to,
        uint256 value
    ) public override(IERC20, ERC20Upgradeable) returns (bool) {
        if (msg.sender != address(getRewardVault())) revert TransferNotSupported();
        return super.transferFrom(from, to, value);
    }

    /// @inheritdoc WasabiVault
    /// @dev Actually BERA and WBERA, not ETH and WETH
    function depositEth(address receiver) public payable override(IWasabiVault, WasabiVault) nonReentrant returns (uint256) {
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
        RewardStorage storage rs = _getRewardStorage();
        IRewardVault rewardVault = rs.rewardVault;
        _mint(address(this), shares);
        uint256 rewardFee = shares.mulDiv(rs.rewardFeeBips, HUNDRED_PERCENT, Math.Rounding.Floor);
        rewardVault.delegateStake(receiver, shares - rewardFee);
        if (rewardFee != 0) {
            rewardVault.stake(rewardFee);
            rs.rewardFeeUserBalance[receiver] += rewardFee;
        }
        
        totalAssetValue += assets;
        emit Deposit(msg.sender, receiver, assets, shares);

        return shares;
    }

    /// @inheritdoc IBeraVault
    function claimBGTReward(address _receiver) external onlyAdmin returns (uint256) {
        return getRewardVault().getReward(address(this), _receiver);
    }

    /// @inheritdoc IBeraVault
    function setRewardFeeBips(uint256 _rewardFeeBips) external onlyAdmin {
        if (_rewardFeeBips > HUNDRED_PERCENT) revert InvalidFeeBips();
        RewardStorage storage rs = _getRewardStorage();
        emit RewardFeeBipsUpdated(rs.rewardFeeBips, _rewardFeeBips);
        rs.rewardFeeBips = _rewardFeeBips;
    }

    /// @inheritdoc IBeraVault
    function getRewardFeeBips() public view returns (uint256) {
        return _getRewardStorage().rewardFeeBips;
    }

    /// @inheritdoc IBeraVault
    function getRewardVault() public view returns (IRewardVault) {
        return _getRewardStorage().rewardVault;
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
        RewardStorage storage rs = _getRewardStorage();
        IRewardVault rewardVault = rs.rewardVault;
        _mint(address(this), shares);
        uint256 rewardFee = shares.mulDiv(rs.rewardFeeBips, HUNDRED_PERCENT, Math.Rounding.Floor);
        rewardVault.delegateStake(receiver, shares - rewardFee);
        if (rewardFee != 0) {
            rewardVault.stake(rewardFee);
            rs.rewardFeeUserBalance[receiver] += rewardFee;
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

        // Withdraw shares from the reward vault on the user's behalf and burn
        (uint256 delegateWithdrawAmount, uint256 feeWithdrawAmount) = _getWithdrawAmounts(owner, shares);
        RewardStorage storage rs = _getRewardStorage();
        IRewardVault rewardVault = rs.rewardVault;
        rewardVault.delegateWithdraw(owner, delegateWithdrawAmount);
        if (feeWithdrawAmount != 0) {
            rewardVault.withdraw(feeWithdrawAmount);
            rs.rewardFeeUserBalance[owner] -= feeWithdrawAmount;
        }
        _burn(address(this), shares);

        totalAssetValue -= assets;

        if (totalSupply() == 0) {
            // Clean dust if no shares are left
            assets += totalAssetValue;
            totalAssetValue = 0;
        }

        IERC20(asset()).safeTransfer(receiver, assets);

        emit Withdraw(caller, receiver, owner, assets, shares);
    }

    // @notice Determine the portion of shares to withdraw with delegateWithdraw vs withdraw
    // @dev If user has 100 shares, 10 of which are fee shares, and they want to withdraw 20 shares total,
    //      we should withdraw 20% of the delegated stake and 20% of the fee stake, or 18 and 2 shares respectively
    function _getWithdrawAmounts(address owner, uint256 shares) internal view returns (uint256, uint256) {
        RewardStorage storage rs = _getRewardStorage();
        uint256 totalDelegatedStake = rs.rewardVault.balanceOf(owner);
        uint256 totalFeeStake = rs.rewardFeeUserBalance[owner];
        if (totalDelegatedStake + totalFeeStake == shares) {
            // Handle full withdrawal
            return (totalDelegatedStake, totalFeeStake);
        }
        uint256 feeWithdrawAmount = totalFeeStake.mulDiv(shares, totalDelegatedStake + totalFeeStake, Math.Rounding.Floor);
        uint256 delegateWithdrawAmount = shares - feeWithdrawAmount;
        if (delegateWithdrawAmount > totalDelegatedStake) {
            // Handle edge case where rounding error causes delegateWithdrawAmount to exceed totalDelegatedStake
            feeWithdrawAmount += delegateWithdrawAmount - totalDelegatedStake;
            delegateWithdrawAmount = totalDelegatedStake;
        } else if (feeWithdrawAmount > totalFeeStake) {
            // Handle edge case where rounding error causes feeWithdrawAmount to exceed totalFeeStake
            delegateWithdrawAmount += feeWithdrawAmount - totalFeeStake;
            feeWithdrawAmount = totalFeeStake;
        }
        return (delegateWithdrawAmount, feeWithdrawAmount);
    }

    function _getRewardStorage() internal pure returns (RewardStorage storage $) {
        assembly {
            $.slot := REWARD_STORAGE_SLOT
        }
    }
}