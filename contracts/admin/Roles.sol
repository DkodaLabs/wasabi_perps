// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

library Roles {
    uint64 public constant LIQUIDATOR_ROLE = 100;
    uint64 public constant ORDER_SIGNER_ROLE = 101;
    uint64 public constant ORDER_EXECUTOR_ROLE = 102;
}