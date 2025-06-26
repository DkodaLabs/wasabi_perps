// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./BaseWasabiPool.sol";
import "./Hash.sol";
import "./PerpUtils.sol";
import "./addressProvider/IAddressProvider.sol";

contract WasabiLongPool is BaseWasabiPool {
    using Hash for Position;
    using Hash for ClosePositionRequest;
    using Hash for ClosePositionOrder;
    using SafeERC20 for IERC20;

    /// @dev initializer for proxy
    /// @param _addressProvider address provider contract
    /// @param _manager the PerpManager contract
    function initialize(IAddressProvider _addressProvider, PerpManager _manager) public virtual initializer {
        __WasabiLongPool_init(_addressProvider, _manager);
    }

    function __WasabiLongPool_init(IAddressProvider _addressProvider, PerpManager _manager) internal virtual onlyInitializing {
        __BaseWasabiPool_init(true, _addressProvider, _manager);
    }

    /// @inheritdoc IWasabiPerps
    function openPosition(
        OpenPositionRequest calldata _request,
        Signature calldata _signature
    ) external payable returns (Position memory) {
        return openPositionFor(_request, _signature, msg.sender);
    }

    /// @inheritdoc IWasabiPerps
    function openPositionFor(
        OpenPositionRequest calldata _request,
        Signature calldata _signature,
        address _trader
    ) public virtual payable nonReentrant returns (Position memory) {
        // Validate Request
        _validateOpenPositionRequest(_request, _signature);

        // Validate sender
        if (msg.sender != _trader) {
            if (msg.sender != address(addressProvider.getWasabiRouter()))
                revert SenderNotTrader();
        }
        if (_request.existingPosition.id != 0) {
            if (_request.existingPosition.trader != _trader)
                revert SenderNotTrader();
        }

        // If principal is 0, then we are just adding collateral to an existing position
        if (_request.principal > 0) {
            // Borrow principal from the vault
            IWasabiVault vault = getVault(_request.currency);
            vault.checkMaxLeverage(_request.downPayment, _request.downPayment + _request.principal);
            vault.borrow(_request.principal);
        }

        // Purchase target token
        (uint256 amountSpent, uint256 collateralAmount) = PerpUtils.executeSwapFunctions(
            _request.functionCallDataList,
            IERC20(_request.currency),
            IERC20(_request.targetCurrency)
        );

        if (collateralAmount < _request.minTargetAmount) revert InsufficientCollateralReceived();
        if (amountSpent == 0) revert InsufficientPrincipalUsed();

        // Pay open fees
        _handleOpenFees(_request.fee, _request.currency, _request.referrer);

        return _finalizePosition(_trader, _request, collateralAmount);
    }

    /// @inheritdoc IWasabiPerps
    function closePosition(
        PayoutType _payoutType,
        ClosePositionRequest calldata _request,
        Signature calldata _signature,
        ClosePositionOrder calldata _order,
        Signature calldata _orderSignature // signed by trader
    ) external payable nonReentrant onlyRole(Roles.LIQUIDATOR_ROLE) {
        uint256 id = _request.position.id;
        address trader = _request.position.trader;
        if (id != _order.positionId) revert InvalidOrder();
        if (_request.expiration < block.timestamp) revert OrderExpired();
        if (_order.expiration < block.timestamp) revert OrderExpired();

        _validateSigner(trader, _order.hash(), _orderSignature);
        _validateSigner(address(0), _request.hash(), _signature);
        
        ClosePositionInternalArgs memory args = ClosePositionInternalArgs({
            _interest: _request.interest,
            _amount: _request.amount,
            _executionFee: _order.executionFee,
            _payoutType: _payoutType,
            _isLiquidation: false,
            _referrer: _request.referrer
        });
        CloseAmounts memory closeAmounts = _closePositionInternal(
            args, 
            _request.position, 
            _request.functionCallDataList
        );

        uint256 actualMakerAmount = closeAmounts.collateralSold;
        uint256 actualTakerAmount = closeAmounts.payout + closeAmounts.closeFee + closeAmounts.interestPaid + closeAmounts.principalRepaid;

        // order price      = order.takerAmount / order.makerAmount
        // executed price   = actualTakerAmount / actualMakerAmount
        // TP: executed price >= order price
        //      actualTakerAmount / actualMakerAmount >= order.takerAmount / order.makerAmount
        //      actualTakerAmount * order.makerAmount >= order.takerAmount * actualMakerAmount
        // SL: executed price <= order price
        //      actualTakerAmount / actualMakerAmount <= order.takerAmount / order.makerAmount
        //      actualTakerAmount * order.makerAmount <= order.takerAmount * actualMakerAmount

        uint8 orderType = _order.orderType;
        if (orderType > 1) {
            revert InvalidOrder();
        } else if (orderType == 0 
            ? actualTakerAmount * _order.makerAmount < _order.takerAmount * actualMakerAmount
            : actualTakerAmount * _order.makerAmount > _order.takerAmount * actualMakerAmount
        ) {
            revert PriceTargetNotReached();
        }

        if (positions[id] == CLOSED_POSITION_HASH) {
            emit PositionClosedWithOrder(
                id,
                trader,
                orderType,
                closeAmounts.payout,
                closeAmounts.principalRepaid,
                closeAmounts.interestPaid,
                closeAmounts.closeFee
            );
        } else {
            emit PositionDecreasedWithOrder(
                id, 
                trader, 
                orderType,
                closeAmounts.payout,
                closeAmounts.principalRepaid,
                closeAmounts.interestPaid,
                closeAmounts.closeFee,
                closeAmounts.pastFees,
                closeAmounts.collateralSold,
                closeAmounts.downPaymentReduced
            );
        }
    }

    /// @inheritdoc IWasabiPerps
    function closePosition(
        PayoutType _payoutType,
        ClosePositionRequest calldata _request,
        Signature calldata _signature
    ) external payable nonReentrant {
        _validateSigner(address(0), _request.hash(), _signature);
        uint256 id = _request.position.id;
        address trader = _request.position.trader;
        _checkCanClosePosition(trader);
        if (_request.expiration < block.timestamp) revert OrderExpired();
        
        ClosePositionInternalArgs memory args = ClosePositionInternalArgs({
            _interest: _request.interest,
            _amount: _request.amount,
            _executionFee: 0,
            _payoutType: _payoutType,
            _isLiquidation: false,
            _referrer: _request.referrer
        });
        CloseAmounts memory closeAmounts = _closePositionInternal(
            args, 
            _request.position, 
            _request.functionCallDataList
        );
        
        if (positions[id] == CLOSED_POSITION_HASH) {
            emit PositionClosed(
                id,
                trader,
                closeAmounts.payout,
                closeAmounts.principalRepaid,
                closeAmounts.interestPaid,
                closeAmounts.closeFee
            );
        } else {
            emit PositionDecreased(
                id, 
                trader, 
                closeAmounts.payout,
                closeAmounts.principalRepaid,
                closeAmounts.interestPaid,
                closeAmounts.closeFee,
                closeAmounts.pastFees,
                closeAmounts.collateralSold,
                closeAmounts.downPaymentReduced
            );
        }
    }

    /// @inheritdoc IWasabiPerps
    function liquidatePosition(
        PayoutType _payoutType,
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions,
        address _referrer
    ) external payable nonReentrant onlyRole(Roles.LIQUIDATOR_ROLE) {
        ClosePositionInternalArgs memory args = ClosePositionInternalArgs({
            _interest: _interest,
            _amount: 0,
            _executionFee: 0,
            _payoutType: _payoutType,
            _isLiquidation: true,
            _referrer: _referrer
        });
        CloseAmounts memory closeAmounts =
            _closePositionInternal(args, _position, _swapFunctions);
        uint256 liquidationThreshold = _position.principal * 5 / 100;
        if (closeAmounts.payout + closeAmounts.liquidationFee > liquidationThreshold) revert LiquidationThresholdNotReached();

        emit PositionLiquidated(
            _position.id,
            _position.trader,
            closeAmounts.payout,
            closeAmounts.principalRepaid,
            closeAmounts.interestPaid,
            closeAmounts.closeFee
        );
    }

    /// @dev Closes a given position
    /// @param _args the close position arguments
    /// @param _position the position
    /// @param _swapFunctions the swap functions
    /// @return closeAmounts the close amounts
    function _closePositionInternal(
        ClosePositionInternalArgs memory _args,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) internal virtual returns (CloseAmounts memory closeAmounts) {
        uint256 id = _position.id;
        if (positions[id] != _position.hash()) revert InvalidPosition();
        if (_swapFunctions.length == 0) revert SwapFunctionNeeded();

        uint256 collateralAmount = _position.collateralAmount;
        uint256 downPayment = _position.downPayment;

        if (_args._amount == 0 || _args._amount > collateralAmount) {
            _args._amount = collateralAmount;
        }
        _args._interest = _computeInterest(_position, _args._interest);

        // Sell tokens
        (closeAmounts.collateralSold, closeAmounts.payout) = PerpUtils.executeSwapFunctions(
            _swapFunctions, 
            IERC20(_position.collateralCurrency), 
            IERC20(_position.currency)
        );

        if (closeAmounts.collateralSold > _args._amount) revert TooMuchCollateralSpent();

        uint256 principalToRepay;
        if (closeAmounts.collateralSold == collateralAmount) {
            // Fully closing the position
            principalToRepay = _position.principal;
            closeAmounts.pastFees = _position.feesToBePaid;
            closeAmounts.downPaymentReduced = downPayment;
        } else {
            // Partial close - scale the principal and fees to be paid accordingly
            principalToRepay = _position.principal * closeAmounts.collateralSold / collateralAmount;
            closeAmounts.pastFees = _position.feesToBePaid * closeAmounts.collateralSold / collateralAmount;
            closeAmounts.downPaymentReduced = downPayment * closeAmounts.collateralSold / collateralAmount;
        }

        // 1. Deduct principal
        (closeAmounts.payout, closeAmounts.principalRepaid) = PerpUtils.deduct(closeAmounts.payout, principalToRepay);

        // 2. Deduct interest
        (closeAmounts.payout, closeAmounts.interestPaid) = PerpUtils.deduct(closeAmounts.payout, _args._interest);

        // 3. Deduct fees
        (closeAmounts.payout, closeAmounts.closeFee) =
            PerpUtils.deduct(
                closeAmounts.payout,
                PerpUtils.computeCloseFee(_position, closeAmounts.payout + closeAmounts.principalRepaid, isLongPool) + _args._executionFee);

        // 4. Deduct liquidation fee
        if (_args._isLiquidation) {
            (closeAmounts.payout, closeAmounts.liquidationFee) = PerpUtils.deduct(
                closeAmounts.payout, 
                _getDebtController().getLiquidationFee(downPayment, _position.currency, _position.collateralCurrency)
            );
        }

        // 5. Deduct partner fee from close fee if referrer is a partner
        if (_args._referrer != address(0)) {
            closeAmounts.closeFee -= _handlePartnerFees(closeAmounts.closeFee, _position.currency, _args._referrer);
        }
        
        // Repay principal + interest to the vault
        _recordRepayment(
            principalToRepay,
            _position.currency,
            _args._isLiquidation,
            closeAmounts.principalRepaid,
            closeAmounts.interestPaid
        );

        _payCloseAmounts(
            _args._payoutType,
            _position.currency,
            _position.trader,
            closeAmounts
        );

        if (closeAmounts.collateralSold != collateralAmount) {
            Position memory position = Position(
                id,
                _position.trader,
                _position.currency,
                _position.collateralCurrency,
                _position.lastFundingTimestamp,
                downPayment - closeAmounts.downPaymentReduced,
                _position.principal - closeAmounts.principalRepaid,
                collateralAmount - closeAmounts.collateralSold,
                _position.feesToBePaid - closeAmounts.pastFees
            );
            positions[id] = position.hash();
        } else {
            positions[id] = CLOSED_POSITION_HASH;
        }
    }

    function _finalizePosition(
        address _trader,
        OpenPositionRequest calldata _request,
        uint256 _collateralAmount
    ) internal returns (Position memory) {
        bool isEdit = _request.existingPosition.id != 0;

        Position memory position = Position(
            _request.id,
            _trader,
            _request.currency,
            _request.targetCurrency,
            isEdit ? _request.existingPosition.lastFundingTimestamp : block.timestamp,
            _request.existingPosition.downPayment + _request.downPayment,
            _request.existingPosition.principal + _request.principal,
            _request.existingPosition.collateralAmount + _collateralAmount,
            _request.existingPosition.feesToBePaid + _request.fee
        );

        positions[_request.id] = position.hash();

        if (isEdit) {
            if (_request.principal > 0) {
                emit PositionIncreased(
                    _request.id, 
                    _trader,
                    _request.downPayment, 
                    _request.principal, 
                    _collateralAmount, 
                    _request.fee
                );
            } else {
                emit CollateralAddedToPosition(_request.id, _trader, _request.downPayment, _collateralAmount, _request.fee);
            }
        } else {
            emit PositionOpened(
                _request.id,
                _trader,
                _request.currency,
                _request.targetCurrency,
                _request.downPayment,
                _request.principal,
                _collateralAmount,
                _request.fee
            );
        }

        return position;
    }
}