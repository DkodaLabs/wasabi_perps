// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IWasabiPerps} from "../IWasabiPerps.sol";

contract MockSmartWallet is IERC1271 {
    address public immutable owner;

    bytes4 private constant INVALID_SIGNATURE = bytes4(0xffffffff);

    constructor(address _owner) {
        owner = _owner;
    }

    receive() external payable {}

    function approve(address _token, address _spender, uint256 _amount) external {
        require(msg.sender == owner, "not owner");
        IERC20(_token).approve(_spender, _amount);
    }

    function openPosition(
        IWasabiPerps _pool,
        IWasabiPerps.OpenPositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature
    ) external {
        require(msg.sender == owner, "not owner");
        _pool.openPosition(_request, _signature);
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        // Decode the signature
        require(signature.length == 65, "bad sig length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }

        // Recover the signer
        address signer = ecrecover(hash, v, r, s);
        return signer == owner ? IERC1271.isValidSignature.selector : INVALID_SIGNATURE;
    }
}