// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import "./IWasabiPerps.sol";
import "./BaseWasabiPool.sol";
import "./Hash.sol";
import "./addressProvider/IAddressProvider.sol";

contract WasabiLongPool is BaseWasabiPool, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Hash for Position;
    using Hash for ClosePositionRequest;

    constructor(IAddressProvider _addressProvider) BaseWasabiPool(true, _addressProvider) payable {}

    /// @inheritdoc IWasabiPerps
    function openPosition(
        OpenPositionRequest calldata _request,
        Signature calldata _signature
    ) external payable nonReentrant {
        // Validate Request
        validateOpenPositionRequest(_request, _signature);

        // Compute finalDownPayment amount after fees
        uint256 fee = addressProvider.getFeeController().computeTradeFee(_request.downPayment);
        uint256 downPayment = _request.downPayment - fee;

        // Validate principal
        uint256 maxPrincipal = addressProvider.getDebtController().computeMaxPrincipal(_request.targetCurrency, _request.currency, downPayment);
        if (_request.principal > maxPrincipal) revert PrincipalTooHigh();
        if (address(this).balance - msg.value < _request.principal) revert InsufficientAvailablePrincipal();

        IERC20 collateralToken = IERC20(_request.targetCurrency);
        uint256 balanceBefore = collateralToken.balanceOf(address(this));

        // Purchase target token
        executeFunctions(_request.functionCallDataList);

        uint256 collateralAmount = collateralToken.balanceOf(address(this)) - balanceBefore;
        if (collateralAmount < _request.minTargetAmount) revert InsufficientCollateralReceived();

        Position memory position = Position(
            _request.id,
            _msgSender(),
            _request.currency,
            _request.targetCurrency,
            block.timestamp,
            downPayment,
            _request.principal,
            collateralAmount,
            fee
        );

        positions[_request.id] = position.hash();

        emit OpenPosition(
            _request.id,
            position.trader,
            position.currency,
            position.collateralCurrency,
            position.downPayment,
            position.principal,
            position.collateralAmount,
            position.feesToBePaid
        );
    }

    /// @inheritdoc IWasabiPerps
    function closePosition(
        ClosePositionRequest calldata _request,
        Signature calldata _signature
    ) external payable nonReentrant {
        validateSignature(_request.hash(), _signature);
        if (_request.position.trader != _msgSender()) revert SenderNotTrader();
        if (_request.expiration < block.timestamp) revert OrderExpired();
        
        (uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) =
            closePositionInternal(_request.interest, _request.position, _request.functionCallDataList);

        emit ClosePosition(
            _request.position.id,
            _request.position.trader,
            payout,
            principalRepaid,
            interestPaid,
            feeAmount
        );
    }

    /// @inheritdoc IWasabiPerps
    function liquidatePosition(
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) external payable onlyOwner {
        (uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) = closePositionInternal(_interest, _position, _swapFunctions);
        uint256 liquidationThreshold = _position.principal * 5 / 100;
        if (payout > liquidationThreshold) {
            revert LiquidationThresholdNotReached();
        }

        emit PositionLiquidated(
            _position.id,
            _position.trader,
            payout,
            principalRepaid,
            interestPaid,
            feeAmount
        );
    }

    function closePositionInternal(
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) internal returns(uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) {
        if (positions[_position.id] != _position.hash()) revert InvalidPosition();
        if (_swapFunctions.length == 0) revert SwapFunctionNeeded();

        // Not needed
        // require(_position.currency == address(0), 'Invalid Currency'); 
        // require(_position.collateralCurrency != address(0), 'Invalid Target Currency');

        uint256 maxInterest = addressProvider.getDebtController().computeMaxInterest(_position.collateralCurrency, _position.principal, _position.lastFundingTimestamp);
        if (_interest == 0 || _interest > maxInterest) {
            _interest = maxInterest;
        }

        uint256 principalBalanceBefore = address(this).balance;

        // Sell tokens
        executeFunctions(_swapFunctions);

        payout = address(this).balance - principalBalanceBefore;

        // 1. Deduct principal
        (payout, principalRepaid) = deduct(payout, _position.principal);

        // 2. Deduct interest
        (payout, interestPaid) = deduct(payout, _interest);

        // 3. Deduct fees
        (payout, feeAmount) = deduct(payout, addressProvider.getFeeController().computeTradeFee(payout));

        payETH(payout, _position.trader);
        payETH(_position.feesToBePaid + feeAmount, addressProvider.getFeeController().getFeeReceiver());

        positions[_position.id] = bytes32(0);
    }
}