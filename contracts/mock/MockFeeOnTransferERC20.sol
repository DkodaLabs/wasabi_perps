// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockFeeOnTransferERC20 is ERC20, Ownable {
    uint256 public constant BIPS_DENOMINATOR = 10_000;
    uint256 public immutable transferFeeBips;
    address public immutable feeRecipient;

    constructor(
        string memory name,
        string memory symbol,
        uint256 _transferFeeBips,
        address _feeRecipient
    ) ERC20(name, symbol) Ownable(msg.sender) {
        require(_transferFeeBips <= BIPS_DENOMINATOR, "InvalidFeeBips");
        require(_feeRecipient != address(0), "InvalidFeeRecipient");
        transferFeeBips = _transferFeeBips;
        feeRecipient = _feeRecipient;
    }

    function mint(uint256 _amount) external onlyOwner {
        _mint(msg.sender, _amount);
    }

    function mint(address _receiver, uint256 _amount) external onlyOwner {
        _mint(_receiver, _amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || transferFeeBips == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 feeAmount = value * transferFeeBips / BIPS_DENOMINATOR;
        uint256 netAmount = value - feeAmount;

        if (feeAmount > 0) {
            super._update(from, feeRecipient, feeAmount);
        }
        super._update(from, to, netAmount);
    }
}
