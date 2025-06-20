// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/utils/math/Math.sol";

import "./BaseWasabiPool.sol";
import "./Hash.sol";
import "./PerpUtils.sol";
import "./addressProvider/IAddressProvider.sol";

contract WasabiShortPool is BaseWasabiPool {
    using Hash for Position;
    using Hash for ClosePositionRequest;
    using Hash for ClosePositionOrder;
    using SafeERC20 for IERC20;
    using Math for uint256;

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
        
        uint256 downPayment = _request.downPayment;
        uint256 principal = _request.principal;
        uint256 fee = _request.fee;

        uint256 amountSpent;
        uint256 collateralAmount;
        // If principal is 0, then we are just adding collateral to an existing position, which for shorts doesn't require any swaps
        if (principal > 0) {
            // Borrow principal from the vault
            IERC20 principalToken = IERC20(_request.currency);
            IWasabiVault vault = getVault(_request.currency);

            vault.borrow(principal);

            // Purchase target token
            (amountSpent, collateralAmount) = PerpUtils.executeSwapFunctions(
                _request.functionCallDataList,
                principalToken,
                IERC20(_request.targetCurrency)
            );

            if (collateralAmount < _request.minTargetAmount) revert InsufficientCollateralReceived();

            vault.checkMaxLeverage(downPayment, collateralAmount);

            // Check the principal usage and return any excess principal to the vault
            if (amountSpent > principal && principal > 0) {
                revert PrincipalTooHigh();
            } else if (amountSpent < principal) {
                principalToken.safeTransfer(address(vault), principal - amountSpent);
            }
        }
        
        uint256 id = _request.id;
        Position memory position = Position(
            id,
            _trader,
            _request.currency,
            _request.targetCurrency,
            _request.existingPosition.id != 0 ?  _request.existingPosition.lastFundingTimestamp : block.timestamp,
            _request.existingPosition.downPayment + downPayment,
            _request.existingPosition.principal + amountSpent,
            _request.existingPosition.collateralAmount + collateralAmount + downPayment,
            _request.existingPosition.feesToBePaid + fee
        );

        positions[id] = position.hash();

        if (_request.existingPosition.id != 0) {
            if (principal > 0) {
                emit PositionIncreased(
                    id, 
                    _trader,
                    downPayment, 
                    amountSpent, 
                    collateralAmount + downPayment, 
                    fee
                );
            } else {
                emit CollateralAddedToPosition(id, _trader, downPayment, downPayment, fee);
            }
        } else {
            emit PositionOpened(
                id,
                _trader,
                _request.currency,
                _request.targetCurrency,
                downPayment,
                amountSpent,
                position.collateralAmount,
                fee
            );
        }

        return position;
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
        _validateSigner(address(0), _request.hash(), _signature);

        CloseAmounts memory closeAmounts =
            _closePositionInternal(_payoutType, _request.interest, _request.amount, _request.position, _request.functionCallDataList, _order.executionFee, false);

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
        _validateSigner(address(0), _request.hash(), _signature);
        address trader = _request.position.trader;
        _checkCanClosePosition(trader);
        if (_request.expiration < block.timestamp) revert OrderExpired();
        
        CloseAmounts memory closeAmounts =
            _closePositionInternal(_payoutType, _request.interest, _request.amount, _request.position, _request.functionCallDataList, 0, false);

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

    function recordInterest(Position[] calldata _positions, uint256[] calldata _interests, FunctionCallData[] calldata _swapFunctions) external nonReentrant {
        if (_positions.length != _interests.length) revert InvalidInput();
        if (_swapFunctions.length == 0) revert SwapFunctionNeeded(); // Swap functions are needed for short interest

        uint256 length = _positions.length;
        address currency = _positions[0].currency;
        address collateralCurrency = _positions[0].collateralCurrency;
        IWasabiVault vault = getVault(currency);
        uint256 totalInterest;

        for (uint256 i = 0; i < length; ) {
            Position memory position = _positions[i];
            if (position.currency != currency) revert InvalidCurrency();
            if (position.collateralCurrency != collateralCurrency) revert InvalidTargetCurrency();

            uint256 interest = _interests[i];
            uint256 maxInterest = _getDebtController()
                .computeMaxInterest(position.currency, position.principal, position.lastFundingTimestamp);
            if (interest > maxInterest || interest == 0) revert InvalidInterestAmount();

            totalInterest += interest;

            unchecked {
                i++;
            }
        }

        (uint256 collateralSold, uint256 interestReceived) = PerpUtils.executeSwapFunctions(
            _swapFunctions,
            IERC20(collateralCurrency),
            IERC20(currency)
        );

        if (interestReceived != totalInterest) revert InsufficientPrincipalRepaid();

        for (uint256 i = 0; i < length; ) {
            Position memory position = _positions[i];
            uint256 interest = _interests[i];

            uint256 collateralReduced = i == length - 1 ? collateralSold : collateralSold.mulDiv(interest, totalInterest);
            uint256 downPaymentReduced = collateralReduced.mulDiv(position.downPayment, position.collateralAmount);

            position.collateralAmount -= collateralReduced;
            position.downPayment -= downPaymentReduced;
            positions[position.id] = position.hash();

            collateralSold -= collateralReduced;
            totalInterest -= interest;
            
            emit InterestPaid(
                position.id,
                position.trader,
                interest,
                position.principal,
                position.collateralAmount,
                position.downPayment
            );

            unchecked {
                i++;
            }
        }

        vault.recordRepayment(interestReceived, 0, false);
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
    ) internal virtual returns (CloseAmounts memory closeAmounts) {
        uint256 id = _position.id;
        if (positions[id] != _position.hash()) revert InvalidPosition();
        if (_swapFunctions.length == 0) revert SwapFunctionNeeded();

        uint256 principal = _position.principal;
        uint256 collateralAmount = _position.collateralAmount;
        uint256 downPayment = _position.downPayment;

        if (_amountToBuy == 0 || _amountToBuy > principal) {
            _amountToBuy = principal;
        }
        _interest = _computeInterest(_position, _interest);

        // Sell tokens
        (closeAmounts.collateralSold, closeAmounts.principalRepaid) = PerpUtils.executeSwapFunctions(
            _swapFunctions,
            IERC20(_position.collateralCurrency),
            IERC20(_position.currency)
        );

        if (closeAmounts.collateralSold > collateralAmount) revert TooMuchCollateralSpent();

        // 1. Deduct interest
        (closeAmounts.interestPaid, closeAmounts.principalRepaid) = PerpUtils.deduct(closeAmounts.principalRepaid, _amountToBuy);
        if (closeAmounts.principalRepaid < _amountToBuy) revert InsufficientPrincipalRepaid();
        
        if (_amountToBuy == principal) {
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
            _validateDifference(_interest, closeAmounts.interestPaid, 3);
        }

        // 2. Deduct fees
        (closeAmounts.payout, closeAmounts.closeFee) =
            PerpUtils.deduct(
                closeAmounts.payout,
                PerpUtils.computeCloseFee(_position, closeAmounts.payout + closeAmounts.collateralReduced, isLongPool) + _executionFee);

        // 3. Deduct liquidation fee
        if (_isLiquidation) {
            (closeAmounts.payout, closeAmounts.liquidationFee) = PerpUtils.deduct(
                closeAmounts.payout, 
                _getDebtController().getLiquidationFee(downPayment, _position.currency, _position.collateralCurrency)
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

        if (closeAmounts.principalRepaid < principal && !_isLiquidation) {
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