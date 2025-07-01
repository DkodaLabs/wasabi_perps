// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./BaseWasabiPool.sol";
import "./Hash.sol";
import "./PerpUtils.sol";
import "./addressProvider/IAddressProvider.sol";

contract WasabiShortPool is BaseWasabiPool {
    using Hash for Position;
    using Hash for ClosePositionRequest;
    using Hash for ClosePositionOrder;
    using SafeERC20 for IERC20;

    /// @dev initializer for proxy
    /// @param _addressProvider address provider contract
    /// @param _manager the PerpManager contract
    function initialize(IAddressProvider _addressProvider, PerpManager _manager) public virtual initializer {
        __WasabiShortPool_init(_addressProvider, _manager);
    }

    function __WasabiShortPool_init(IAddressProvider _addressProvider, PerpManager _manager) internal virtual onlyInitializing {
        __BaseWasabiPool_init(false, _addressProvider, _manager);
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
    ) public payable nonReentrant returns (Position memory) {
        // Validate Request
        _validateOpenPositionRequest(_request, _signature);

        // Validate sender
        if (msg.sender != _trader && msg.sender != address(addressProvider.getWasabiRouter())) 
            revert SenderNotTrader();
        if (_request.existingPosition.id != 0 && _request.existingPosition.trader != _trader) 
            revert SenderNotTrader();

        uint256 amountSpent;
        uint256 collateralAmount;
        // If principal is 0, then we are just adding collateral to an existing position, which for shorts doesn't require any swaps
        if (_request.principal > 0) {
            // Borrow principal from the vault
            IERC20 principalToken = IERC20(_request.currency);
            IWasabiVault vault = getVault(_request.currency);

            vault.borrow(_request.principal);

            // Purchase target token
            (amountSpent, collateralAmount) = PerpUtils.executeSwapFunctions(
                _request.functionCallDataList,
                principalToken,
                IERC20(_request.targetCurrency)
            );

            if (collateralAmount < _request.minTargetAmount) revert InsufficientCollateralReceived();

            vault.checkMaxLeverage(_request.downPayment, collateralAmount);

            // Check the principal usage and return any excess principal to the vault
            if (amountSpent > _request.principal && _request.principal > 0) {
                revert PrincipalTooHigh();
            } else if (amountSpent < _request.principal) {
                principalToken.safeTransfer(address(vault), _request.principal - amountSpent);
            }
        }
        
        return _finalizePosition(_trader, _request, collateralAmount, amountSpent);
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
        if (id != _order.positionId) revert InvalidOrder();
        if (_order.expiration < block.timestamp) revert OrderExpired();
        if (_request.expiration < block.timestamp) revert OrderExpired();

        address trader = _request.position.trader;
        _validateSigner(trader, _order.hash(), _orderSignature);
        _validateSignature(_request.hash(), _signature);

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

        uint256 interestPaid = closeAmounts.interestPaid;
        uint256 principalRepaid = closeAmounts.principalRepaid;
        uint256 actualMakerAmount = closeAmounts.collateralSold;
        uint256 actualTakerAmount = interestPaid + principalRepaid;

        // order price      = order.makerAmount / order.takerAmount
        // executed price   = actualMakerAmount / actualTakerAmount
        // TP: executed price <= order price
        //      actualMakerAmount / actualTakerAmount <= order.makerAmount / order.takerAmount
        //      actualMakerAmount * order.takerAmount <= order.makerAmount * actualTakerAmount
        // SL: executed price >= order price
        //      actualMakerAmount / actualTakerAmount >= order.makerAmount / order.takerAmount
        //      actualMakerAmount * order.takerAmount >= order.makerAmount * actualTakerAmount

        uint8 orderType = _order.orderType;
        if (orderType > 1) {
            revert InvalidOrder();
        } else if (orderType == 0 
            ? actualMakerAmount * _order.takerAmount > _order.makerAmount * actualTakerAmount
            : actualMakerAmount * _order.takerAmount < _order.makerAmount * actualTakerAmount
        ) {
            revert PriceTargetNotReached();
        }

        if (positions[id] == CLOSED_POSITION_HASH) {
            emit PositionClosedWithOrder(
                id,
                trader,
                orderType,
                closeAmounts.payout,
                principalRepaid,
                interestPaid,
                closeAmounts.closeFee
            );
        } else {
            emit PositionDecreasedWithOrder(
                id, 
                trader, 
                orderType,
                closeAmounts.payout,
                principalRepaid,
                interestPaid,
                closeAmounts.closeFee,
                closeAmounts.pastFees,
                closeAmounts.collateralReduced,
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
        _validateSignature(_request.hash(), _signature);
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

        uint256 id = _request.position.id;
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
                closeAmounts.collateralReduced,
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
        uint256 liquidationThreshold = _position.collateralAmount * 5 / 100;
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

        uint256 principal = _position.principal;
        uint256 collateralAmount = _position.collateralAmount;
        uint256 downPayment = _position.downPayment;

        if (_args._amount == 0 || _args._amount > principal) {
            _args._amount = principal;
        }
        _args._interest = _computeInterest(_position, _args._interest);

        // Sell tokens
        (closeAmounts.collateralSold, closeAmounts.principalRepaid) = PerpUtils.executeSwapFunctions(
            _swapFunctions,
            IERC20(_position.collateralCurrency),
            IERC20(_position.currency)
        );

        if (closeAmounts.collateralSold > collateralAmount) revert TooMuchCollateralSpent();

        // 1. Deduct interest
        (closeAmounts.interestPaid, closeAmounts.principalRepaid) = PerpUtils.deduct(closeAmounts.principalRepaid, _args._amount);
        if (closeAmounts.principalRepaid < _args._amount) revert InsufficientPrincipalRepaid();
        
        if (_args._amount == principal) {
            // Full close
            // Payout and fees are paid in collateral
            closeAmounts.pastFees = _position.feesToBePaid;
            closeAmounts.downPaymentReduced = downPayment;
            closeAmounts.collateralReduced = collateralAmount;
            (closeAmounts.payout, ) = PerpUtils.deduct(collateralAmount, closeAmounts.collateralSold);
        } else {
            // Partial close
            // Scale the collateral by the fraction of the principal repaid
            closeAmounts.collateralReduced = collateralAmount * closeAmounts.principalRepaid / principal;
            closeAmounts.downPaymentReduced = downPayment * closeAmounts.principalRepaid / principal;
            closeAmounts.pastFees = _position.feesToBePaid * closeAmounts.principalRepaid / principal;
            (closeAmounts.payout, ) = PerpUtils.deduct(closeAmounts.collateralReduced, closeAmounts.collateralSold);
        }

        if (closeAmounts.interestPaid > 0) {
            _validateDifference(_args._interest, closeAmounts.interestPaid, 3);
        }

        // 2. Deduct fees
        (closeAmounts.payout, closeAmounts.closeFee) =
            PerpUtils.deduct(
                closeAmounts.payout,
                PerpUtils.computeCloseFee(_position, closeAmounts.payout + closeAmounts.collateralReduced, isLongPool) + _args._executionFee);

        // 3. Deduct liquidation fee
        if (_args._isLiquidation) {
            (closeAmounts.payout, closeAmounts.liquidationFee) = PerpUtils.deduct(
                closeAmounts.payout, 
                _getDebtController().getLiquidationFee(downPayment, _position.currency, _position.collateralCurrency)
            );
        }
        
        // Repay principal + interest to the vault
        _recordRepayment(
            _args._amount,
            _position.currency,
            _args._isLiquidation,
            closeAmounts.principalRepaid,
            closeAmounts.interestPaid
        );

        _payCloseAmounts(
            _args._payoutType,
            _position.collateralCurrency,
            _position.trader,
            _args._referrer,
            closeAmounts
        );

        if (closeAmounts.principalRepaid < principal && !_args._isLiquidation) {
            Position memory position = Position(
                id,
                _position.trader,
                _position.currency,
                _position.collateralCurrency,
                _position.lastFundingTimestamp,
                downPayment - closeAmounts.downPaymentReduced,
                principal - closeAmounts.principalRepaid,
                collateralAmount - closeAmounts.collateralReduced,
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
        uint256 _collateralAmount,
        uint256 _amountSpent
    ) internal returns (Position memory) {
        bool isEdit = _request.existingPosition.id != 0;

        Position memory position = Position(
            _request.id,
            _trader,
            _request.currency,
            _request.targetCurrency,
            isEdit ? _request.existingPosition.lastFundingTimestamp : block.timestamp,
            _request.existingPosition.downPayment + _request.downPayment,
            _request.existingPosition.principal + _amountSpent,
            _request.existingPosition.collateralAmount + _collateralAmount + _request.downPayment,
            _request.existingPosition.feesToBePaid + _request.fee
        );

        positions[_request.id] = position.hash();

        if (isEdit) {
            if (_request.principal > 0) {
                emit PositionIncreased(
                    _request.id, 
                    _trader,
                    _request.downPayment, 
                    _amountSpent, 
                    _collateralAmount + _request.downPayment, 
                    _request.fee
                );
            } else {
                emit CollateralAddedToPosition(_request.id, _trader, _request.downPayment, _collateralAmount + _request.downPayment, _request.fee);
            }
        } else {
            emit PositionOpened(
                _request.id,
                _trader,
                _request.currency,
                _request.targetCurrency,
                _request.downPayment,
                _amountSpent,
                position.collateralAmount,
                _request.fee
            );
        }

        return position;
    }

    /// @dev Validates if the value is deviated x percentage from the value to compare
    /// @param _value the value
    /// @param _valueToCompare the value to compare
    /// @param _percentage the percentage difference
    function _validateDifference(uint256 _value, uint256 _valueToCompare, uint256 _percentage) internal pure {
        // Check if interest paid is within 3% range of expected interest
        uint256 diff = _value >= _valueToCompare ? _value - _valueToCompare : _valueToCompare - _value;
        if (diff * 100 > _percentage * _value) revert ValueDeviatedTooMuch();
    }
}