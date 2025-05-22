// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./WasabiVault.sol";
import "./ITimelock.sol";

contract TimelockWasabiVault is WasabiVault, ITimelock {
    using SafeERC20 for IERC20;

    // @notice The slot where the TimelockStorage struct is stored
    // @dev This equals bytes32(uint256(keccak256("wasabi.vault.timelock_storage")) - 1)
    bytes32 private constant TIMELOCK_STORAGE_SLOT = 0x62e75e49e19da7df0349e60d38b9c7cdb591478ceb82eff336d44e21a7b66787;

    /// @dev Initializer for proxy
    /// @notice This function should only be called to initialize a new vault
    /// @param _longPool The WasabiLongPool contract
    /// @param _shortPool The WasabiShortPool contract
    /// @param _addressProvider The address provider
    /// @param _manager The PerpManager contract that will own this vault
    /// @param _asset The asset
    /// @param name The name of the vault
    /// @param symbol The symbol of the vault
    /// @param _timelockDuration The duration of the timelock in seconds
    function initialize(
        IWasabiPerps _longPool,
        IWasabiPerps _shortPool,
        IAddressProvider _addressProvider,
        PerpManager _manager,
        IERC20 _asset,
        string memory name,
        string memory symbol,
        uint256 _timelockDuration
    ) public virtual initializer {
        __WasabiVault_init(_longPool, _shortPool, _addressProvider, _manager, _asset, name, symbol);
        _getTimelockStorage().timelockDuration = _timelockDuration;
        emit TimelockDurationUpdated(0, _timelockDuration);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                         MODIFIERS                          */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    modifier onlyAfterTimelock(address account) {
        TimelockStorage storage ts = _getTimelockStorage();
        if (block.timestamp < ts.timelockStart[account] + ts.timelockDuration) {
            revert TimelockNotEnded();
        }
        _;
    }

    modifier setTimelock(address account) {
        _getTimelockStorage().timelockStart[account] = block.timestamp;
        _;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                          GETTERS                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    function getTimelockDuration() external view returns (uint256) {
        return _getTimelockStorage().timelockDuration;
    }

    function getTimelockEnd(address account) external view returns (uint256) {
        TimelockStorage storage ts = _getTimelockStorage();
        return ts.timelockStart[account] + ts.timelockDuration;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                           WRITES                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /** @dev See {IERC4626-deposit}. */
    function depositEth(address receiver) public payable override setTimelock(receiver) returns (uint256) {
        return super.depositEth(receiver);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                       ADMIN FUNCTIONS                      */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    function setTimelockDuration(uint256 duration) external onlyAdmin {
        TimelockStorage storage ts = _getTimelockStorage();
        emit TimelockDurationUpdated(ts.timelockDuration, duration);
        ts.timelockDuration = duration;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                     INTERNAL FUNCTIONS                     */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc ERC4626Upgradeable
    function _deposit(
        address caller,
        address receiver,
        uint256 assets,
        uint256 shares
    ) internal override setTimelock(receiver) {
        super._deposit(caller, receiver, assets, shares);
    }

    /// @inheritdoc ERC4626Upgradeable
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override onlyAfterTimelock(owner) {
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    function _getTimelockStorage() internal pure returns (TimelockStorage storage $) {
        assembly {
            $.slot := TIMELOCK_STORAGE_SLOT
        }
    }
}