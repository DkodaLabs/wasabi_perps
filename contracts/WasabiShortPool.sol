// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./BaseWasabiPool.sol";
import "./Hash.sol";
import "./PerpUtils.sol";
import "./addressProvider/IAddressProvider.sol";

contract WasabiShortPool is BaseWasabiPool {
    using Hash for Position;
    using Hash for ClosePositionRequest;
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
    ) external payable nonReentrant {
        // Validate Request
        _validateOpenPositionRequest(_request, _signature);

        // Validate principal
        IERC20 principalToken = IERC20(_request.currency);
        IERC20 collateralToken = IERC20(_request.targetCurrency);

        uint256 principalBalanceBefore = principalToken.balanceOf(address(this));
        if (_request.principal > principalBalanceBefore) revert InsufficientAvailablePrincipal();

        uint256 collateralBalanceBefore = collateralToken.balanceOf(address(this));

        // Purchase target token
        PerpUtils.executeFunctions(_request.functionCallDataList);

        uint256 collateralReceived = collateralToken.balanceOf(address(this)) - collateralBalanceBefore;
        if (collateralReceived < _request.minTargetAmount) revert InsufficientCollateralReceived();

        uint256 principalUsed = principalBalanceBefore - principalToken.balanceOf(address(this));

        // The effective price = principalReceived / collateralReceived
        uint256 swappedDownPaymentAmount = _request.downPayment * principalUsed / collateralReceived;
        uint256 maxPrincipal =
            addressProvider.getDebtController()
                .computeMaxPrincipal(
                    _request.targetCurrency,
                    _request.currency,
                    swappedDownPaymentAmount);

        if (_request.principal > maxPrincipal + swappedDownPaymentAmount) revert PrincipalTooHigh();
        validateDifference(_request.principal, principalUsed, 1);

        Position memory position = Position(
            _request.id,
            msg.sender,
            _request.currency,
            _request.targetCurrency,
            block.timestamp,
            _request.downPayment,
            principalUsed,
            collateralReceived + _request.downPayment,
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
    }

    /// @inheritdoc IWasabiPerps
    function closePosition(
        bool _unwrapWETH,
        ClosePositionRequest calldata _request,
        Signature calldata _signature
    ) external payable nonReentrant {
        _validateSignature(_request.hash(), _signature);
        if (_request.position.trader != msg.sender) revert SenderNotTrader();
        if (_request.expiration < block.timestamp) revert OrderExpired();
        
        CloseAmounts memory closeAmounts =
            _closePositionInternal(_unwrapWETH, _request.interest, _request.position, _request.functionCallDataList, false);

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
        bool _unwrapWETH,
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) public override payable nonReentrant onlyRole(Roles.LIQUIDATOR_ROLE) {
        CloseAmounts memory closeAmounts =
            _closePositionInternal(_unwrapWETH, _interest, _position, _swapFunctions, true);
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
        IERC20(_position.currency).safeTransferFrom(_position.trader, address(this), amountOwed);

        // 2. Trader receives collateral - closeFees
        uint256 closeFee = _position.feesToBePaid; // Close fee is the same as open fee
        uint256 claimAmount = _position.collateralAmount - closeFee;

        CloseAmounts memory _closeAmounts = CloseAmounts(
            claimAmount,
            _position.principal,
            interestPaid,
            _position.feesToBePaid,
            closeFee,
            0
        );

        _payCloseAmounts(
            true,
            IWETH(_position.collateralCurrency),
            _position.trader,
            _closeAmounts
        );

        // 3. Record interest earned and pay fees
        getVault(_position.currency).recordInterestEarned(interestPaid);

        emit PositionClaimed(
            _position.id,
            _position.trader,
            claimAmount,
            _position.principal,
            interestPaid,
            closeFee
        );

        delete positions[_position.id];
    }

    /// @dev Closes a given position
    /// @param _unwrapWETH flag indicating if the payout should be unwrapped to ETH
    /// @param _interest the interest amount to be paid
    /// @param _position the position
    /// @param _swapFunctions the swap functions
    /// @return closeAmounts the close amounts
    /// @param _isLiquidation flag indicating if the close is a liquidation
    function _closePositionInternal(
        bool _unwrapWETH,
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions,
        bool _isLiquidation
    ) internal returns(CloseAmounts memory closeAmounts) {
        if (positions[_position.id] != _position.hash()) revert InvalidPosition();
        if (_swapFunctions.length == 0) revert SwapFunctionNeeded();

        _interest = _computeInterest(_position, _interest);

        IERC20 principalToken = IERC20(_position.currency);
        IWETH collateralToken = IWETH(
            _position.collateralCurrency == address(0)
                ? addressProvider.getWethAddress()
                : _position.collateralCurrency
        );

        uint256 collateralSpent = collateralToken.balanceOf(address(this)) + address(this).balance;
        uint256 principalBalanceBefore = principalToken.balanceOf(address(this));

        // Sell tokens
        PerpUtils.executeFunctions(_swapFunctions);

        // Principal paid is in currency
        closeAmounts.principalRepaid = principalToken.balanceOf(address(this)) - principalBalanceBefore;

        collateralSpent = collateralSpent - collateralToken.balanceOf(address(this)) - address(this).balance;
        if (collateralSpent > _position.collateralAmount) revert TooMuchCollateralSpent();

        // 1. Deduct interest
        (closeAmounts.interestPaid, closeAmounts.principalRepaid) = PerpUtils.deduct(closeAmounts.principalRepaid, _position.principal);
        if (closeAmounts.interestPaid > 0) {
            validateDifference(_interest, closeAmounts.interestPaid, 3);
        }

        // Payout and fees are paid in collateral
        (closeAmounts.payout, ) = PerpUtils.deduct(_position.collateralAmount, collateralSpent);

        // 2. Deduct fees
        (closeAmounts.payout, closeAmounts.closeFee) = PerpUtils.deduct(closeAmounts.payout, PerpUtils.computeCloseFee(_position, closeAmounts.payout, isLongPool));

        // 3. Deduct liquidation fee
        if (_isLiquidation) {
            closeAmounts.liquidationFee = _computeLiquidationFee(_position.downPayment);
            (closeAmounts.payout, closeAmounts.liquidationFee) = PerpUtils.deduct(closeAmounts.payout, closeAmounts.liquidationFee);
        }

        closeAmounts.pastFees = _position.feesToBePaid;

        _recordRepayment(
            _position.principal,
            _position.currency,
            closeAmounts.payout,
            closeAmounts.principalRepaid,
            closeAmounts.interestPaid
        );

        _payCloseAmounts(
            _unwrapWETH,
            collateralToken,
            _position.trader,
            closeAmounts
        );

        delete positions[_position.id];
    }

    /// @dev Validates if the value is deviated x percentage from the value to compare
    /// @param _value the value
    /// @param _valueToCompare the value to compare
    /// @param _percentage the percentage difference
    function validateDifference(uint256 _value, uint256 _valueToCompare, uint256 _percentage) internal pure {
        // Check if interest paid is within 3% range of expected interest
        uint256 diff = _value >= _valueToCompare ? _value - _valueToCompare : _valueToCompare - _value;
        if (diff * 100 > _percentage * _value) revert ValueDeviatedTooMuch();
    }
}