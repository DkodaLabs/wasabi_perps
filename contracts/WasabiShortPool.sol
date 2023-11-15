// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IWasabiPerps.sol";
import "./BaseWasabiPool.sol";
import "./Hash.sol";
import "./addressProvider/IAddressProvider.sol";

contract WasabiShortPool is BaseWasabiPool {
    using SafeERC20 for IERC20;
    using Hash for Position;
    using Hash for ClosePositionRequest;

    /// @notice initializer for proxy
    /// @param _addressProvider address provider contract
    function initialize(IAddressProvider _addressProvider) public initializer {
        __BaseWasabiPool_init(false, _addressProvider);
    }

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
        uint256 swappedAmount = downPayment * _request.swapPrice / _request.swapPriceDenominator;

        // Validate principal
        IERC20 principalToken = IERC20(_request.currency);
        uint256 maxPrincipal = addressProvider.getDebtController().computeMaxPrincipal(_request.targetCurrency, _request.currency, swappedAmount);
        if (_request.principal > maxPrincipal) revert PrincipalTooHigh();

        uint256 principalBalanceBefore = principalToken.balanceOf(address(this));
        if (_request.principal + swappedAmount > principalBalanceBefore) revert InsufficientAvailablePrincipal();

        uint256 balanceBefore = address(this).balance - downPayment;

        // Purchase target token
        executeFunctions(_request.functionCallDataList);

        uint256 collateralAmount = address(this).balance - balanceBefore;
        if (collateralAmount < _request.minTargetAmount) revert InsufficientCollateralReceived();

        Position memory position = Position(
            _request.id,
            _msgSender(),
            _request.currency,
            _request.targetCurrency,
            block.timestamp,
            downPayment,
            principalBalanceBefore - principalToken.balanceOf(address(this)),
            collateralAmount,
            fee
        );

        positions[_request.id] = position.hash();

        emit PositionOpened(
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

        emit PositionClosed(
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
        uint256 liquidationThreshold = _position.collateralAmount * 5 / 100;
        require(payout > liquidationThreshold, "Liquidation threshold not reached");

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

        uint256 maxInterest = addressProvider.getDebtController().computeMaxInterest(_position.currency, _position.collateralAmount, _position.lastFundingTimestamp);
        if (_interest == 0 || _interest > maxInterest) {
            _interest = maxInterest;
        }

        IERC20 principalToken = IERC20(_position.currency);

        uint256 collateralBalanceBefore = address(this).balance;
        uint256 principalBalanceBefore = principalToken.balanceOf(address(this));

        // Sell tokens
        executeFunctions(_swapFunctions);

        principalRepaid = principalToken.balanceOf(address(this)) - principalBalanceBefore;

        (payout, ) = deduct(_position.collateralAmount, collateralBalanceBefore - address(this).balance);

        // 1. Deduct interest
        (payout, interestPaid) = deduct(payout, _interest);

        // 2. Deduct fees
        (payout, feeAmount) = deduct(payout, addressProvider.getFeeController().computeTradeFee(payout));

        payETH(payout, _position.trader);
        payETH(_position.feesToBePaid + feeAmount + interestPaid, addressProvider.getFeeController().getFeeReceiver());

        positions[_position.id] = bytes32(0);
    }
}