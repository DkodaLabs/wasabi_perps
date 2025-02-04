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
        __BaseWasabiPool_init(false, _addressProvider, _manager);
    }

    /// @inheritdoc IWasabiPerps
    function openPosition(
        OpenPositionRequest calldata _request,
        Signature calldata _signature
    ) external payable {
        openPositionFor(_request, _signature, msg.sender);
    }

    /// @inheritdoc IWasabiPerps
    function openPositionFor(
        OpenPositionRequest calldata _request,
        Signature calldata _signature,
        address _trader
    ) public payable nonReentrant {
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

            // Instead of borrowing the full principal and then sending the interest back to the vault, just borrow the principal - interest
            vault.borrow(_request.principal - _request.interestToPay);
            if (_request.interestToPay > 0) {
                vault.recordRepayment(_request.interestToPay, 0, false);
            }

            // Purchase target token
            (amountSpent, collateralAmount) = PerpUtils.executeSwapFunctions(
                _request.functionCallDataList,
                principalToken,
                IERC20(_request.targetCurrency)
            );

            if (collateralAmount < _request.minTargetAmount) revert InsufficientCollateralReceived();

            vault.checkMaxLeverage(_request.downPayment, collateralAmount);

            // Check the principal usage and return any excess principal to the vault
            if (amountSpent > _request.principal - _request.interestToPay && _request.principal > 0) {
                revert PrincipalTooHigh();
            } else if (amountSpent < _request.principal - _request.interestToPay) {
                principalToken.safeTransfer(address(vault), _request.principal - _request.interestToPay - amountSpent);
            }
        }
        
        Position memory position = Position(
            _request.id,
            _trader,
            _request.currency,
            _request.targetCurrency,
            block.timestamp,
            _request.existingPosition.downPayment + _request.downPayment,
            _request.existingPosition.principal + amountSpent,
            _request.existingPosition.collateralAmount + collateralAmount + _request.downPayment,
            _request.existingPosition.feesToBePaid + _request.fee
        );

        positions[_request.id] = position.hash();

        if (_request.existingPosition.id != 0) {
            if (_request.principal > 0) {
                emit PositionIncreased(
                    _request.id, 
                    _trader,
                    _request.downPayment, 
                    _request.principal, 
                    collateralAmount + _request.downPayment, 
                    _request.fee,
                    _request.interestToPay
                );
            } else {
                emit CollateralAddedToPosition(_request.id, _trader, _request.downPayment);
            }
        } else {
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
    }

    /// @inheritdoc IWasabiPerps
    function closePosition(
        PayoutType _payoutType,
        ClosePositionRequest calldata _request,
        Signature calldata _signature,
        ClosePositionOrder calldata _order,
        Signature calldata _orderSignature // signed by trader
    ) external payable nonReentrant onlyRole(Roles.LIQUIDATOR_ROLE) {
        if (_request.position.id != _order.positionId) revert InvalidOrder();
        if (_order.expiration < block.timestamp) revert OrderExpired();
        if (_request.expiration < block.timestamp) revert OrderExpired();

        _validateSigner(_request.position.trader, _order.hash(), _orderSignature);
        _validateSigner(address(0), _request.hash(), _signature);

        CloseAmounts memory closeAmounts =
            _closePositionInternal(_payoutType, _request.interest, _request.amount, _request.position, _request.functionCallDataList, _order.executionFee, false);

        uint256 actualMakerAmount = closeAmounts.collateralSpent;
        uint256 actualTakerAmount = closeAmounts.interestPaid + closeAmounts.principalRepaid;

        // order price      = order.makerAmount / order.takerAmount
        // executed price   = actualMakerAmount / actualTakerAmount
        // TP: executed price <= order price
        //      actualMakerAmount / actualTakerAmount <= order.makerAmount / order.takerAmount
        //      actualMakerAmount * order.takerAmount <= order.makerAmount * actualTakerAmount
        // SL: executed price >= order price
        //      actualMakerAmount / actualTakerAmount >= order.makerAmount / order.takerAmount
        //      actualMakerAmount * order.takerAmount >= order.makerAmount * actualTakerAmount

        if (_order.orderType == 0) { // Take Profit
            if (actualMakerAmount * _order.takerAmount > _order.makerAmount * actualTakerAmount) 
                revert PriceTargetNotReached();
        } else if (_order.orderType == 1) { // Stop Loss
            if (actualMakerAmount * _order.takerAmount < _order.makerAmount * actualTakerAmount) 
                revert PriceTargetNotReached();
        } else {
            revert InvalidOrder();
        }

        if (positions[_request.position.id] == CLOSED_POSITION_HASH) {
            emit PositionClosedWithOrder(
                _request.position.id,
                _request.position.trader,
                _order.orderType,
                closeAmounts.payout,
                closeAmounts.principalRepaid,
                closeAmounts.interestPaid,
                closeAmounts.closeFee
            );
        } else {
            emit PositionDecreasedWithOrder(
                _request.position.id, 
                _request.position.trader, 
                _order.orderType,
                closeAmounts.payout,
                closeAmounts.principalRepaid,
                closeAmounts.interestPaid,
                closeAmounts.closeFee,
                closeAmounts.pastFees,
                closeAmounts.collateralSpent
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
        _checkCanClosePosition(_request.position.trader);
        if (_request.expiration < block.timestamp) revert OrderExpired();
        
        CloseAmounts memory closeAmounts =
            _closePositionInternal(_payoutType, _request.interest, _request.amount, _request.position, _request.functionCallDataList, 0, false);

        if (positions[_request.position.id] == CLOSED_POSITION_HASH) {
            emit PositionClosed(
                _request.position.id,
                _request.position.trader,
                closeAmounts.payout,
                closeAmounts.principalRepaid,
                closeAmounts.interestPaid,
                closeAmounts.closeFee
            );
        } else {
            emit PositionDecreased(
                _request.position.id, 
                _request.position.trader, 
                closeAmounts.payout,
                closeAmounts.principalRepaid,
                closeAmounts.interestPaid,
                closeAmounts.closeFee,
                closeAmounts.pastFees,
                closeAmounts.collateralSpent
            );
        }
    }

    /// @inheritdoc IWasabiPerps
    function liquidatePosition(
        PayoutType _payoutType,
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) external payable nonReentrant onlyRole(Roles.LIQUIDATOR_ROLE) {
        CloseAmounts memory closeAmounts =
            _closePositionInternal(_payoutType, _interest, 0, _position, _swapFunctions, 0, true);
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

    /// @inheritdoc IWasabiPerps
    function claimPosition(Position calldata _position) external payable nonReentrant {
        if (positions[_position.id] != _position.hash()) revert InvalidPosition();
        if (_position.trader != msg.sender) revert SenderNotTrader();

        // 1. Trader pays principal + interest
        uint256 interestPaid = _computeInterest(_position, 0);
        uint256 amountOwed = _position.principal + interestPaid;
        IERC20 principalToken = IERC20(_position.currency);
        principalToken.safeTransferFrom(_position.trader, address(this), amountOwed);

        // 2. Trader receives collateral - closeFees
        uint256 closeFee = _position.feesToBePaid; // Close fee is the same as open fee
        uint256 claimAmount = _position.collateralAmount - closeFee;

        // 3. Pay fees and repay principal + interest earned to vault
        _recordRepayment(_position.principal, _position.currency, false, _position.principal, interestPaid);

        CloseAmounts memory _closeAmounts = CloseAmounts(
            claimAmount,
            _position.collateralAmount,
            _position.principal,
            interestPaid,
            _position.feesToBePaid,
            closeFee,
            0
        );

        _payCloseAmounts(
            PayoutType.UNWRAPPED,
            _position.collateralCurrency,
            _position.trader,
            _closeAmounts
        );

        emit PositionClaimed(
            _position.id,
            _position.trader,
            claimAmount,
            _position.principal,
            interestPaid,
            closeFee
        );

        positions[_position.id] = CLOSED_POSITION_HASH;
    }

    /// @dev Closes a given position
    /// @param _payoutType whether to send WETH to the trader, send ETH, or deposit WETH to the vault
    /// @param _interest the interest amount to be paid
    /// @param _amountToBuy the amount of principal to buy back, not including interest
    /// @param _position the position
    /// @param _swapFunctions the swap functions
    /// @param _executionFee the execution fee
    /// @param _isLiquidation flag indicating if the close is a liquidation
    /// @return closeAmounts the close amounts
    function _closePositionInternal(
        PayoutType _payoutType,
        uint256 _interest,
        uint256 _amountToBuy,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions,
        uint256 _executionFee,
        bool _isLiquidation
    ) internal returns(CloseAmounts memory closeAmounts) {
        if (positions[_position.id] != _position.hash()) revert InvalidPosition();
        if (_swapFunctions.length == 0) revert SwapFunctionNeeded();

        if (_amountToBuy == 0 || _amountToBuy > _position.principal) {
            _amountToBuy = _position.principal;
        }
        _interest = _computeInterest(_position, _interest);

        // Sell tokens
        (closeAmounts.collateralSpent, closeAmounts.principalRepaid) = PerpUtils.executeSwapFunctions(
            _swapFunctions,
            IERC20(_position.collateralCurrency),
            IERC20(_position.currency)
        );

        if (closeAmounts.collateralSpent > _position.collateralAmount) revert TooMuchCollateralSpent();

        // 1. Deduct interest
        (closeAmounts.interestPaid, closeAmounts.principalRepaid) = PerpUtils.deduct(closeAmounts.principalRepaid, _amountToBuy);
        if (closeAmounts.principalRepaid < _amountToBuy) revert InsufficientPrincipalRepaid();
        
        if (_amountToBuy == _position.principal) {
            // Full close
            // Payout and fees are paid in collateral
            (closeAmounts.payout, ) = PerpUtils.deduct(_position.collateralAmount, closeAmounts.collateralSpent);
            closeAmounts.pastFees = _position.feesToBePaid;
        } else {
            // Partial close
            // Scale the collateral by the fraction of the principal repaid
            uint256 adjCollateral = _position.collateralAmount * _amountToBuy / _position.principal;
            (closeAmounts.payout, ) = PerpUtils.deduct(adjCollateral, closeAmounts.collateralSpent);
            closeAmounts.pastFees = _position.feesToBePaid * _amountToBuy / _position.principal;
        }

        if (closeAmounts.interestPaid > 0) {
            _validateDifference(_interest, closeAmounts.interestPaid, 3);
        }

        // 2. Deduct fees
        (closeAmounts.payout, closeAmounts.closeFee) =
            PerpUtils.deduct(
                closeAmounts.payout,
                PerpUtils.computeCloseFee(_position, closeAmounts.payout, isLongPool) + _executionFee);

        // 3. Deduct liquidation fee
        if (_isLiquidation) {
            (closeAmounts.payout, closeAmounts.liquidationFee) = PerpUtils.deduct(
                closeAmounts.payout, 
                _getDebtController().getLiquidationFee(_position.downPayment, _position.currency, _position.collateralCurrency)
            );
        }
        
        // Repay principal + interest to the vault
        _recordRepayment(
            _amountToBuy,
            _position.currency,
            _isLiquidation,
            closeAmounts.principalRepaid,
            closeAmounts.interestPaid
        );

        _payCloseAmounts(
            _payoutType,
            _position.collateralCurrency,
            _position.trader,
            closeAmounts
        );

        if (closeAmounts.principalRepaid < _position.principal && !_isLiquidation) {
            Position memory position = Position(
                _position.id,
                _position.trader,
                _position.currency,
                _position.collateralCurrency,
                block.timestamp,
                _position.downPayment - _position.downPayment * closeAmounts.collateralSpent / _position.collateralAmount,
                _position.principal - closeAmounts.principalRepaid,
                _position.collateralAmount - closeAmounts.collateralSpent,
                _position.feesToBePaid - closeAmounts.pastFees
            );
            positions[_position.id] = position.hash();
        } else {
            positions[_position.id] = CLOSED_POSITION_HASH;
        }
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