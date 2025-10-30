// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IWasabiACPAccountFactory} from "./IWasabiACPAccountFactory.sol";
import {WasabiACPAccount} from "./WasabiACPAccount.sol";
import {PerpManager} from "../admin/PerpManager.sol";

contract WasabiACPAccountFactory is 
    IWasabiACPAccountFactory, 
    UUPSUpgradeable, 
    OwnableUpgradeable
{
    using SafeERC20 for IERC20;
    
    UpgradeableBeacon public beacon;
    address public wasabiAgent;
    mapping(address user => address acpAccount) public userToACPAccount;

    /// @dev Checks if the caller is an admin
    modifier onlyAdmin() {
        _getManager().isAdmin(msg.sender);
        _;
    }

    /// @dev Checks if the caller is the WasabiAgent
    modifier onlyWasabiAgent() {
        if (msg.sender != wasabiAgent) revert CallerNotWasabiAgent();
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
    /// @param _wasabiAgent The WasabiAgent contract
    function initialize(PerpManager _manager, address _wasabiAgent) external initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(address(_manager));

        beacon = new UpgradeableBeacon(address(new WasabiACPAccount()), address(this));
        wasabiAgent = _wasabiAgent;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      ADMIN FUNCTIONS                       */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IWasabiACPAccountFactory
    function upgradeBeacon(address _newImplementation) external onlyAdmin {
        beacon.upgradeTo(_newImplementation);
    }

    /// @inheritdoc IWasabiACPAccountFactory
    function setWasabiAgent(address _wasabiAgent) external onlyAdmin {
        wasabiAgent = _wasabiAgent;
    }

    /// @inheritdoc IWasabiACPAccountFactory
    function createACPAccount(address _user) external onlyWasabiAgent {
        if (userToACPAccount[_user] != address(0)) revert WasabiACPAccountAlreadyDeployed(_user);
        userToACPAccount[_user] = address(new BeaconProxy(address(beacon), abi.encodeWithSelector(WasabiACPAccount.initialize.selector, _user)));
        emit WasabiACPAccountCreated(_user, userToACPAccount[_user]);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                     INTERNAL FUNCTIONS                     */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// solhint-disable-next-line no-empty-blocks
    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal view override onlyAdmin {}

    /// @dev returns the manager of the contract
    function _getManager() internal view returns (PerpManager) {
        return PerpManager(owner());
    }
}