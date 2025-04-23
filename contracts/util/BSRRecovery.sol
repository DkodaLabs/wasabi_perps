// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";


contract BSRRecovery is UUPSUpgradeable, OwnableUpgradeable {
    function initialize() external initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(msg.sender);
    }

    function recoverERC20(address token, uint256 amount) external {
        IERC20(token).transfer(msg.sender, amount);
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address newImplementation) internal override onlyOwner {}
}