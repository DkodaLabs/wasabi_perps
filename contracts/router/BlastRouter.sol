// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./WasabiRouter.sol";
import "../blast/AbstractBlastContract.sol";

contract BlastRouter is WasabiRouter, AbstractBlastContract {
    /// @dev Initializes the router as per UUPSUpgradeable
    /// @param _longPool The long pool address
    /// @param _shortPool The short pool address
    /// @param _weth The WETH address
    /// @param _manager The PerpManager address
    /// @param _swapRouter The swap router address
    /// @param _feeReceiver The address to receive withdrawal fees
    /// @param _withdrawFeeBips The fee to be charged on vault withdrawals if no swap is performed (in bips)
    function initialize(
        IWasabiPerps _longPool,
        IWasabiPerps _shortPool,
        IWETH _weth,
        PerpManager _manager,
        address _swapRouter,
        address _feeReceiver,
        uint256 _withdrawFeeBips
    ) public override initializer {
        __Ownable_init(address(_manager));
        __ReentrancyGuard_init();
        __EIP712_init("WasabiRouter", "1");
        __UUPSUpgradeable_init();
        __AbstractBlastContract_init();

        _configurePointsOperator(msg.sender);

        longPool = _longPool;
        shortPool = _shortPool;
        weth = _weth;
        swapRouter = _swapRouter;
        feeReceiver = _feeReceiver;
        withdrawFeeBips = _withdrawFeeBips;
    }

    /// @dev claim all gas
    function claimGas(address contractAddress, address recipientOfGas) external onlyAdmin returns (uint256) {
        return _getBlast().claimMaxGas(contractAddress, recipientOfGas);
    }
}