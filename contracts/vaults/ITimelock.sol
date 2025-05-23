// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface ITimelock {
    error TimelockNotEnded(); // 0x050f6771

    event TimelockDurationUpdated(uint256 oldDuration, uint256 newDuration);

    struct TimelockStorage {
        uint256 timelockDuration;
        mapping(address => uint256) timelockStart;
    }
    
    function getTimelockEnd(address account) external view returns (uint256);

    function getTimelockDuration() external view returns (uint256);

    function setTimelockDuration(uint256 duration) external;
}