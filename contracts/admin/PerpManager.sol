// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/manager/AccessManagerUpgradeable.sol";

contract PerpManager is UUPSUpgradeable, AccessManagerUpgradeable {

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev initializer for proxy
    function initialize() public initializer {
        __AccessManager_init(msg.sender);
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal view override {
        isAdmin(msg.sender);
    }

    /// @dev check if account is admin
    function isAdmin(address account) public view {
        checkRole(ADMIN_ROLE, account);
    }

    /// @dev check if account has the given role
    /// @param roleId role id
    /// @param account account address
    function checkRole(uint64 roleId, address account) public view {
        (bool hasRole, ) = hasRole(roleId, account);
        if (!hasRole) revert AccessManagerUnauthorizedAccount(account, roleId);
    }
}