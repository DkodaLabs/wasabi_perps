// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./IMultiProtocolSwapRouter.sol";
import "../admin/PerpManager.sol";

contract MultiProtocolSwapRouter is IMultiProtocolSwapRouter, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using Address for address;
    using Address for address payable;

    uint256[50] private __gap;

    /// @dev The swap router to use per protocol
    mapping(Protocol => address) public routers;

    /// @dev Transient variable to store the current router being used, for callback functions
    address private currentRouter;

    /**
     * @dev Checks if the caller is an admin
     */
    modifier onlyAdmin() {
        _getManager().isAdmin(msg.sender);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _manager,
        address _uniswapV2Router, 
        address _uniswapV3Router, 
        address _pancakeV3Router, 
        address _aerodromeRouter, 
        address _aerodromeSlipstreamRouter
    ) external initializer {
        __UUPSUpgradeable_init();
        __Ownable_init(_manager);
        __ReentrancyGuard_init();

        routers[Protocol.UNISWAP_V2] = _uniswapV2Router;
        routers[Protocol.UNISWAP_V3] = _uniswapV3Router;
        routers[Protocol.PANCAKE_V3] = _pancakeV3Router;
        routers[Protocol.AERODROME] = _aerodromeRouter;
        routers[Protocol.AERODROME_SLIPSTREAM] = _aerodromeSlipstreamRouter;
    }

    function executeSwap(Protocol _protocol, bytes calldata _swapData) external payable nonReentrant {
        currentRouter = routers[_protocol];
        if (currentRouter == address(0)) revert InvalidProtocol();

        currentRouter.functionDelegateCall(_swapData);
        currentRouter = address(0);
    }

    fallback() external {
        if (currentRouter == address(0)) revert InvalidProtocol();

        currentRouter.functionDelegateCall(msg.data);
    }

    receive() external payable {}

    function setRouter(Protocol _protocol, address _router) external onlyAdmin {
        routers[_protocol] = _router;
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyAdmin {}

    /// @dev returns the manager of the contract
    function _getManager() internal view returns (PerpManager) {
        return PerpManager(owner());
    }
}