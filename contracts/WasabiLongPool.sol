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
    ) public payable nonReentrant returns (Position memory) {
        // Validate Request
        _validateOpenPositionRequest(_request, _signature);

        IERC20 collateralToken = IERC20(_request.targetCurrency);

        // Borrow principal from the vault
        IWasabiVault vault = getVault(_request.currency);
        vault.checkMaxLeverage(_request.downPayment, _request.downPayment + _request.principal);
        vault.borrow(_request.principal);

        uint256 collateralAmount = collateralToken.balanceOf(address(this));

        // Purchase target token
        PerpUtils.executeFunctions(_request.functionCallDataList);

        collateralAmount = collateralToken.balanceOf(address(this)) - collateralAmount;
        if (collateralAmount < _request.minTargetAmount) revert InsufficientCollateralReceived();

        Position memory position = Position(
            _request.id,
            _trader,
            _request.currency,
            _request.targetCurrency,
            block.timestamp,
            _request.downPayment,
            _request.principal,
            collateralAmount,
            _request.fee
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
        if (_request.position.id != _order.positionId) revert InvalidOrder();
        if (_request.expiration < block.timestamp) revert OrderExpired();
        if (_order.expiration < block.timestamp) revert OrderExpired();
        if (_order.makerAmount != _request.position.collateralAmount) revert TooMuchCollateralSpent();

        _validateSigner(_request.position.trader, _order.hash(), _orderSignature);
        _validateSigner(address(0), _request.hash(), _signature);
        
        CloseAmounts memory closeAmounts =
            _closePositionInternal(_payoutType, _request.interest, _request.position, _request.functionCallDataList, _order.executionFee, false);

        uint256 actualTakerAmount = closeAmounts.payout + closeAmounts.closeFee + closeAmounts.interestPaid + closeAmounts.principalRepaid;

        // For Longs, the whole collateral is sold, so the order.takerAmount is the limit amount that the trader expects
        // TP: Must receive more than or equal to order.takerAmount
        // SL: Must receive less than or equal to order.takerAmount

        if (_order.orderType == 0) { // Take Profit
            if (actualTakerAmount < _order.takerAmount) revert PriceTargetNotReached();
        } else if (_order.orderType == 1) { // Stop Loss
            if (actualTakerAmount > _order.takerAmount) revert PriceTargetNotReached();
        } else {
            revert InvalidOrder();
        }

        emit PositionClosedWithOrder(
            _request.position.id,
            _request.position.trader,
            _order.orderType,
            closeAmounts.payout,
            closeAmounts.principalRepaid,
            closeAmounts.interestPaid,
            closeAmounts.closeFee
        );
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
            _closePositionInternal(_payoutType, _request.interest, _request.position, _request.functionCallDataList, 0, false);

        emit PositionClosed(
            _request.position.id,
            _request.position.trader,
            closeAmounts.payout,
            closeAmounts.principalRepaid,
            closeAmounts.interestPaid,
            closeAmounts.closeFee
        );
    }

    /// @inheritdoc IWasabiPerps
    function liquidatePosition(
        PayoutType _payoutType,
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) external payable nonReentrant onlyRole(Roles.LIQUIDATOR_ROLE) {
        CloseAmounts memory closeAmounts =
            _closePositionInternal(_payoutType, _interest, _position, _swapFunctions, 0, true);
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

    /// @inheritdoc IWasabiPerps
    function claimPosition(Position calldata _position) external payable nonReentrant {
        if (positions[_position.id] != _position.hash()) revert InvalidPosition();
        if (_position.trader != msg.sender) revert SenderNotTrader();

        // 1. Trader pays principal + interest + close fee
        uint256 interestPaid = _computeInterest(_position, 0);
        uint256 closeFee = _position.feesToBePaid; // Close fee is the same as open fee
        uint256 amountOwed = _position.principal + interestPaid + closeFee;
        uint256 msgValue = msg.value;
        if (msgValue > 0) {
            if (_position.currency != _getWethAddress()) 
                revert EthReceivedForNonEthCurrency();
            if (msgValue < amountOwed) revert InsufficientAmountProvided();
            if (msgValue > amountOwed) { // Refund excess ETH
                PerpUtils.payETH(msgValue - amountOwed, _position.trader);
            }
            IWETH(_position.currency).deposit{value: amountOwed}();
        } else {
            IERC20(_position.currency).safeTransferFrom(_position.trader, address(this), amountOwed);
        }

        // 2. Trader receives collateral
        IERC20(_position.collateralCurrency).safeTransfer(_position.trader, _position.collateralAmount);

        // 3. Pay fees and repay principal + interest earned to vault
        _recordRepayment(_position.principal, _position.currency, false, _position.principal, interestPaid);

        CloseAmounts memory _closeAmounts = CloseAmounts(
            0,                          // payout
            _position.collateralAmount, // collateralSpent
            _position.principal,        // principalRepaid
            interestPaid,               // interestPaid
            _position.feesToBePaid,     // pastFees
            closeFee,                   // closeFee
            0                           // liquidationFee
        );

        _payCloseAmounts(PayoutType.UNWRAPPED, _position.currency, _position.trader, _closeAmounts);

        emit PositionClaimed(
            _position.id,
            _position.trader,
            _position.collateralAmount,
            _position.principal,
            interestPaid,
            closeFee
        );

        positions[_position.id] = CLOSED_POSITION_HASH;
    }

    /// @dev Closes a given position
    /// @param _payoutType whether to send WETH to the trader, send ETH, or deposit WETH to the vault
    /// @param _interest the interest amount to be paid
    /// @param _position the position
    /// @param _swapFunctions the swap functions
    /// @param _executionFee the execution fee
    /// @param _isLiquidation flag indicating if the close is a liquidation
    /// @return closeAmounts the close amounts
    function _closePositionInternal(
        PayoutType _payoutType,
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions,
        uint256 _executionFee,
        bool _isLiquidation
    ) internal virtual returns (CloseAmounts memory closeAmounts) {
        if (positions[_position.id] != _position.hash()) revert InvalidPosition();
        if (_swapFunctions.length == 0) revert SwapFunctionNeeded();

        _interest = _computeInterest(_position, _interest);

        IERC20 token = IERC20(_position.currency);
        IERC20 collateralToken = IERC20(_position.collateralCurrency);

        uint256 principalBalanceBefore = token.balanceOf(address(this));
        uint256 collateralSpent = collateralToken.balanceOf(address(this));

        // Sell tokens
        PerpUtils.executeFunctions(_swapFunctions);

        closeAmounts.payout = token.balanceOf(address(this)) - principalBalanceBefore;

        collateralSpent = collateralSpent - collateralToken.balanceOf(address(this));
        if (collateralSpent > _position.collateralAmount) revert TooMuchCollateralSpent();

        // 1. Deduct principal
        (closeAmounts.payout, closeAmounts.principalRepaid) = PerpUtils.deduct(closeAmounts.payout, _position.principal);

        // 2. Deduct interest
        (closeAmounts.payout, closeAmounts.interestPaid) = PerpUtils.deduct(closeAmounts.payout, _interest);

        // 3. Deduct fees
        (closeAmounts.payout, closeAmounts.closeFee) =
            PerpUtils.deduct(
                closeAmounts.payout,
                PerpUtils.computeCloseFee(_position, closeAmounts.payout, isLongPool) + _executionFee);

        // 4. Deduct liquidation fee
        if (_isLiquidation) {
            (closeAmounts.payout, closeAmounts.liquidationFee) = PerpUtils.deduct(
                closeAmounts.payout, 
                _getDebtController().getLiquidationFee(_position.downPayment, _position.currency, _position.collateralCurrency)
            );
        }
        
        closeAmounts.pastFees = _position.feesToBePaid;
        closeAmounts.collateralSpent = collateralSpent;

        // Repay principal + interest to the vault
        _recordRepayment(
            _position.principal,
            _position.currency,
            _isLiquidation,
            closeAmounts.principalRepaid,
            closeAmounts.interestPaid
        );

        _payCloseAmounts(
            _payoutType,
            _position.currency,
            _position.trader,
            closeAmounts
        );

        positions[_position.id] = CLOSED_POSITION_HASH;
    }
}