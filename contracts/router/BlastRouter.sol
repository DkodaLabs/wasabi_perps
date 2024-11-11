// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./WasabiRouter.sol";
import "../blast/AbstractBlastContract.sol";

contract BlastRouter is WasabiRouter, AbstractBlastContract {
    /// @dev Initializes the router as per UUPSUpgradeable
    /// @param _longPool The long pool address
    /// @param _shortPool The short pool address
    /// @param _manager The PerpManager address
    function initialize(
        IWasabiPerps _longPool,
        IWasabiPerps _shortPool,
        PerpManager _manager
    ) public override initializer {
        __Ownable_init(address(_manager));
        __ReentrancyGuard_init();
        __EIP712_init("WasabiRouter", "1");
        __UUPSUpgradeable_init();
        __AbstractBlastContract_init();

        _configurePointsOperator(msg.sender);

        longPool = _longPool;
        shortPool = _shortPool;
    }

    /// @dev claim all gas
    function claimGas(address contractAddress, address recipientOfGas) external onlyAdmin returns (uint256) {
        return _getBlast().claimMaxGas(contractAddress, recipientOfGas);
    }
}