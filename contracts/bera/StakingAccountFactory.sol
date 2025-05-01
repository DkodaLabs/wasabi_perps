// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IStakingAccountFactory.sol";
import "./StakingAccount.sol";
import "../admin/PerpManager.sol";

contract StakingAccountFactory is 
    IStakingAccountFactory, 
    UUPSUpgradeable, 
    OwnableUpgradeable, 
    ReentrancyGuardUpgradeable 
{
    using SafeERC20 for IERC20;
    
    UpgradeableBeacon public beacon;
    IWasabiPerps public longPool;
    IWasabiPerps public shortPool;

    mapping(address user => address stakingAccount) public userToStakingAccount;
    mapping(address stakingToken => IInfraredVault vault) public stakingTokenToVault;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                         MODIFIERS                          */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @dev Checks if the caller is one of the pool contracts
    modifier onlyPool() {
        if (msg.sender != address(longPool)) {
            // Nested checks save a little gas compared to using &&
            if (msg.sender != address(shortPool)) revert CallerNotPool();
        }
        _;
    }

    /// @dev Checks if the caller is an admin
    modifier onlyAdmin() {
        _getManager().isAdmin(msg.sender);
        _;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        INITIALIZER                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the factory
    /// @param _manager The PerpManager contract
    /// @param _longPool The BeraLongPool contract
    /// @param _shortPool The BeraShortPool contract
    function initialize(PerpManager _manager, IWasabiPerps _longPool, IWasabiPerps _shortPool) public initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(address(_manager));
        __ReentrancyGuard_init();

        beacon = new UpgradeableBeacon(address(new StakingAccount()), address(this));
        longPool = _longPool;
        shortPool = _shortPool;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      ADMIN FUNCTIONS                       */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IStakingAccountFactory
    function setVaultForStakingToken(address _stakingToken, address _vault) external onlyAdmin {
        stakingTokenToVault[_stakingToken] = IInfraredVault(_vault);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                       POOL FUNCTIONS                       */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IStakingAccountFactory
    function stakePosition(IWasabiPerps.Position memory _position) public onlyPool {
        IStakingAccount stakingAccount = getOrCreateStakingAccount(_position.trader);
        IInfraredVault vault = stakingTokenToVault[_position.collateralCurrency];
        if (address(vault) == address(0)) revert VaultNotSetForToken(_position.collateralCurrency);

        IERC20 collateralToken = IERC20(_position.collateralCurrency);
        collateralToken.safeTransferFrom(msg.sender, address(stakingAccount), _position.collateralAmount);

        stakingAccount.stakePosition(_position, vault);
        emit StakedPosition(_position.trader, address(stakingAccount), _position.id, _position.collateralAmount);
    }

    /// @inheritdoc IStakingAccountFactory
    function unstakePosition(IWasabiPerps.Position memory _position) public onlyPool {
        IStakingAccount stakingAccount = getOrCreateStakingAccount(_position.trader);
        IInfraredVault vault = stakingTokenToVault[_position.collateralCurrency];
        if (address(vault) == address(0)) revert VaultNotSetForToken(_position.collateralCurrency);

        stakingAccount.unstakePosition(_position, vault, msg.sender);
        _claimRewards(_position.collateralCurrency, _position.trader);
        emit UnstakedPosition(_position.trader, address(stakingAccount), _position.id, _position.collateralAmount);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                           WRITES                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IStakingAccountFactory
    function claimRewards(address _stakingToken) public {
        _claimRewards(_stakingToken, msg.sender);
    }

    /// @inheritdoc IStakingAccountFactory
    function getOrCreateStakingAccount(address _user) public returns (IStakingAccount) {
        address stakingAccount = userToStakingAccount[_user];
        if (address(stakingAccount) == address(0)) {
            stakingAccount = address(new BeaconProxy(
                address(beacon), 
                abi.encodeWithSelector(StakingAccount.initialize.selector, _getManager(), _user)
            ));
            userToStakingAccount[_user] = stakingAccount;
            emit StakingAccountCreated(_user, stakingAccount);
        }
        return IStakingAccount(stakingAccount);
    }

    /// @inheritdoc IStakingAccountFactory
    function upgradeBeacon(address _newImplementation) external onlyAdmin {
        beacon.upgradeTo(_newImplementation);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      INTERNAL FUNCTIONS                    */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    function _claimRewards(address _stakingToken, address _user) internal {
        IStakingAccount stakingAccount = getOrCreateStakingAccount(_user);
        IInfraredVault vault = stakingTokenToVault[_stakingToken];
        if (address(vault) == address(0)) revert VaultNotSetForToken(_stakingToken);

        (IERC20[] memory tokens, uint256[] memory amounts) = stakingAccount.claimRewards(vault);
        for (uint256 i; i < tokens.length; ) {
            emit StakingRewardsClaimed(_user, address(stakingAccount), address(tokens[i]), amounts[i]);
            unchecked {
                i++;
            }
        }
    }

    /// solhint-disable-next-line no-empty-blocks
    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal view override onlyAdmin {}

    /// @dev returns the manager of the contract
    function _getManager() internal view returns (PerpManager) {
        return PerpManager(owner());
    }
}
