// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IPerpManager {
    error AlreadyMigrated();
    error InvalidLength();

    event AuthorizedSignerChanged(
        address indexed trader,
        address indexed signer,
        bool isAuthorized
    );

    /// @dev check if account is admin and revert if not
    function isAdmin(address account) external view;

    /// @dev check if account has the given role and revert if not
    /// @param roleId role id
    /// @param account account address
    function checkRole(uint64 roleId, address account) external view;

    /// @notice check if a signer is authorized to sign for a trader
    /// @param trader address of the account to sign on behalf of
    /// @param signer address of the signer
    /// @return isAuthorized true if the signer is authorized to sign for the trader, false otherwise
    function isAuthorizedSigner(address trader, address signer) external view returns (bool);

    /// @notice Authorize or deauthorize a signer for a trader
    /// @param signer address of the signer to authorize or deauthorize
    /// @param isAuthorized true to authorize the signer, false to deauthorize
    function setAuthorizedSigner(address signer, bool isAuthorized) external;

    /// @notice Deploy a new vault and add it to the short pool
    /// @dev This contract must be granted the ADMIN_ROLE first
    /// @param implementation The implementation address
    /// @param data The data for the initialize function
    function deployVault(address implementation, bytes calldata data) external returns (address);

    /// @notice Upgrade multiple vaults to a new implementation in a single call
    /// @dev This contract must be granted the ADMIN_ROLE first
    /// @param newImplementation The new implementation address
    /// @param vaults The vaults to upgrade
    /// @param calls The call data for each vault (for upgradeToAndCall)
    function upgradeVaults(address newImplementation, address[] calldata vaults, bytes[] calldata calls) external;
}