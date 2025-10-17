// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {IWasabiACPAccount} from "./IWasabiACPAccount.sol";

interface IWasabiACPAccountFactory {
    error CallerNotWasabiAgent();
    error WasabiACPAccountAlreadyDeployed(address _user);

    event WasabiACPAccountCreated(address indexed user, address acpAccount);

    /// @notice Returns the WasabiACPAccount for a user
    /// @param _user The user to get the account for
    /// @return The address of the WasabiACPAccount for the user
    function userToACPAccount(address _user) external view returns (address);

    /// @notice Upgrades the WasabiACPAccount proxies to a new implementation
    /// @param _newImplementation The new implementation to upgrade to
    function upgradeBeacon(address _newImplementation) external;

    /// @notice Creates a new WasabiACPAccount for a user
    /// @param _user The user to create the account for
    function createACPAccount(address _user) external;
}