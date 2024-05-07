// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "./BaseWasabiPool.sol";
import "./Hash.sol";
import "./PerpUtils.sol";
import "./addressProvider/IAddressProvider.sol";

contract WasabiLongPool is BaseWasabiPool {
    using Hash for Position;
    using Hash for ClosePositionRequest;
    using SafeERC20 for IWETH;
    using SafeERC20 for IERC20;

    /// @dev initializer for proxy
    /// @param _addressProvider address provider contract
    /// @param _manager the PerpManager contract
    function initialize(IAddressProvider _addressProvider, PerpManager _manager) public virtual initializer {
        __BaseWasabiPool_init(true, _addressProvider, _manager);
    }

    /// @inheritdoc IWasabiPerps
    function openPosition(
        OpenPositionRequest calldata _request,
        Signature calldata _signature
    ) external payable nonReentrant {
        // Validate Request
        _validateOpenPositionRequest(_request, _signature);

        IERC20 principalToken = IERC20(_request.currency);
        IERC20 collateralToken = IERC20(_request.targetCurrency);

        uint256 maxPrincipal =
            addressProvider.getDebtController()
                .computeMaxPrincipal(_request.targetCurrency, _request.currency, _request.downPayment);
        if (_request.principal > maxPrincipal) revert PrincipalTooHigh();

        // Validate principal
        uint256 balanceAvailableForLoan = principalToken.balanceOf(address(this));
        uint256 totalSwapAmount = _request.principal + _request.downPayment;
        if (balanceAvailableForLoan < totalSwapAmount) {
            // Wrap ETH if needed
            if (_request.currency == addressProvider.getWethAddress() && address(this).balance > 0) {
                PerpUtils.wrapWETH(addressProvider.getWethAddress());
                balanceAvailableForLoan = principalToken.balanceOf(address(this));

                if (balanceAvailableForLoan < totalSwapAmount) revert InsufficientAvailablePrincipal();
            } else {
                revert InsufficientAvailablePrincipal();
            }
        }

        uint256 collateralAmount = collateralToken.balanceOf(address(this));

        // Purchase target token
        PerpUtils.executeFunctions(_request.functionCallDataList);

        collateralAmount = collateralToken.balanceOf(address(this)) - collateralAmount;
        if (collateralAmount < _request.minTargetAmount) revert InsufficientCollateralReceived();

        Position memory position = Position(
            _request.id,
            msg.sender,
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
    ) public override payable nonReentrant onlyRole(Roles.LIQUIDATOR_ROLE) {
        (uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) =
            _closePositionInternal(_unwrapWETH, _interest, _position, _swapFunctions);
        uint256 liquidationThreshold = _position.principal * 5 / 100;
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

        // 1. Trader pays principal + interest + close fee
        uint256 interestPaid = _computeInterest(_position, 0);
        uint256 closeFee = _position.feesToBePaid; // Close fee is the same as open fee
        uint256 amountOwed = _position.principal + interestPaid + closeFee;
        uint256 msgValue = msg.value;
        IWETH weth = IWETH(_position.currency);
        if (msgValue > 0) {
            if (msgValue < amountOwed) revert InsufficientAmountProvided();
            if (msgValue > amountOwed) { // Refund excess ETH
                PerpUtils.payETH(msgValue - amountOwed, _position.trader);
            }
        } else {
            weth.safeTransferFrom(_position.trader, address(this), amountOwed);
        }

        // 2. Trader receives collateral
        IERC20(_position.collateralCurrency).safeTransfer(_position.trader, _position.collateralAmount);

        // 3. Record interest earned and pay fees
        getVault(_position.currency).recordInterestEarned(interestPaid);
        _payCloseAmounts(true, weth, _position.trader, 0, _position.feesToBePaid, closeFee);

        emit PositionClaimed(
            _position.id,
            _position.trader,
            _position.collateralAmount,
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

        IWETH token = IWETH(_position.currency);
        uint256 principalBalanceBefore = token.balanceOf(address(this));

        // Sell tokens
        PerpUtils.executeFunctions(_swapFunctions);

        payout = token.balanceOf(address(this)) - principalBalanceBefore;

        // 1. Deduct principal
        (payout, principalRepaid) = PerpUtils.deduct(payout, _position.principal);

        // 2. Deduct interest
        (payout, interestPaid) = PerpUtils.deduct(payout, _interest);

        // 3. Deduct fees
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
            token,
            _position.trader,
            payout,
            _position.feesToBePaid,
            feeAmount
        );

        delete positions[_position.id];
    }
}