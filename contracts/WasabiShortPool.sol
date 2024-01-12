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
    function initialize(IAddressProvider _addressProvider) public initializer {
        __BaseWasabiPool_init(false, _addressProvider);
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

        uint256 principalReceived = principalBalanceBefore - principalToken.balanceOf(address(this));

        // The effective price = principalReceived / collateralReceived
        uint256 swappedDownPaymentAmount = _request.downPayment * principalReceived / collateralReceived;
        uint256 maxPrincipal =
            addressProvider.getDebtController()
                .computeMaxPrincipal(
                    _request.targetCurrency,
                    _request.currency,
                    swappedDownPaymentAmount);

        if (_request.principal > maxPrincipal + swappedDownPaymentAmount) revert PrincipalTooHigh();
        if (_request.principal != principalReceived) revert InsufficientPrincipalUsed();

        Position memory position = Position(
            _request.id,
            msg.sender,
            _request.currency,
            _request.targetCurrency,
            block.timestamp,
            _request.downPayment,
            principalReceived,
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
        
        (uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) =
            _closePositionInternal(_unwrapWETH, _request.interest, _request.position, _request.functionCallDataList);

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
        bool _unwrapWETH,
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) public override payable onlyOwner {
        (uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) =
            _closePositionInternal(_unwrapWETH, _interest, _position, _swapFunctions);
        uint256 liquidationThreshold = _position.collateralAmount * 5 / 100;
        if (payout > liquidationThreshold) revert LiquidationThresholdNotReached();

        emit PositionLiquidated(
            _position.id,
            _position.trader,
            payout,
            principalRepaid,
            interestPaid,
            feeAmount
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

        _payCloseAmounts(
            true,
            IWETH(_position.collateralCurrency),
            _position.trader,
            claimAmount,
            _position.feesToBePaid,
            closeFee);

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
    /// @return payout the payout amount
    /// @return principalRepaid the principal repaid
    /// @return interestPaid the interest paid
    /// @return feeAmount the fee amount
    function _closePositionInternal(
        bool _unwrapWETH,
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) internal returns(uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) {
        if (positions[_position.id] != _position.hash()) revert InvalidPosition();
        if (_swapFunctions.length == 0) revert SwapFunctionNeeded();

        _interest = _computeInterest(_position, _interest);

        IERC20 principalToken = IERC20(_position.currency);
        IWETH collateralToken = IWETH(
            _position.collateralCurrency == address(0)
                ? addressProvider.getWethAddress()
                : _position.collateralCurrency
        );

        uint256 collateralBalanceBefore = collateralToken.balanceOf(address(this)) + address(this).balance;
        uint256 principalBalanceBefore = principalToken.balanceOf(address(this));

        // Sell tokens
        PerpUtils.executeFunctions(_swapFunctions);

        // Principal paid is in currency
        principalRepaid = principalToken.balanceOf(address(this)) - principalBalanceBefore;

        // 1. Deduct interest
        (interestPaid, principalRepaid) = PerpUtils.deduct(principalRepaid, _position.principal);

        // Payout and fees are paid in collateral
        (payout, ) = PerpUtils.deduct(
            _position.collateralAmount,
            collateralBalanceBefore - collateralToken.balanceOf(address(this)) - address(this).balance);

        // 2. Deduct fees
        (payout, feeAmount) = PerpUtils.deduct(payout, PerpUtils.computeCloseFee(_position, payout, isLongPool));

        _recordRepayment(
            _position.principal,
            _position.currency,
            payout,
            principalRepaid,
            interestPaid
        );

        _payCloseAmounts(
            _unwrapWETH,
            collateralToken,
            _position.trader,
            payout,
            _position.feesToBePaid,
            feeAmount
        );

        delete positions[_position.id];
    }
}