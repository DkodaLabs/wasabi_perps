// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./IWasabiPerps.sol";
import "./BaseWasabiPool.sol";
import "./Hash.sol";
import "./addressProvider/IAddressProvider.sol";
import "./weth/IWETH.sol";
import "hardhat/console.sol";

contract WasabiShortPool is BaseWasabiPool {
    using SafeERC20 for IWETH;
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

        // Validate principal
        IERC20 principalToken = IERC20(_request.currency);
        IERC20 collateralToken = IERC20(_request.targetCurrency);

        uint256 principalBalanceBefore = principalToken.balanceOf(address(this));
        if (_request.principal > principalBalanceBefore) revert InsufficientAvailablePrincipal();

        uint256 collateralBalanceBefore = collateralToken.balanceOf(address(this));

        // Purchase target token
        executeFunctions(_request.functionCallDataList);

        uint256 collateralReceived = collateralToken.balanceOf(address(this)) - collateralBalanceBefore;
        if (collateralReceived < _request.minTargetAmount) revert InsufficientCollateralReceived();

        // The effective price = _request.principal / collateralAmount
        uint256 swappedDownPaymentAmount = downPayment * _request.principal / (collateralReceived - downPayment);        

        uint256 maxPrincipal =
            addressProvider.getDebtController()
                .computeMaxPrincipal(
                    _request.targetCurrency,
                    _request.currency,
                    swappedDownPaymentAmount);

        if (_request.principal > maxPrincipal + swappedDownPaymentAmount) revert PrincipalTooHigh();

        Position memory position = Position(
            _request.id,
            _msgSender(),
            _request.currency,
            _request.targetCurrency,
            block.timestamp,
            downPayment,
            principalBalanceBefore - principalToken.balanceOf(address(this)),
            collateralReceived + downPayment,
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
        bool _unwrapWETH,
        ClosePositionRequest calldata _request,
        Signature calldata _signature
    ) external payable nonReentrant {
        validateSignature(_request.hash(), _signature);
        if (_request.position.trader != _msgSender()) revert SenderNotTrader();
        if (_request.expiration < block.timestamp) revert OrderExpired();
        
        (uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) =
            closePositionInternal(_unwrapWETH, _request.interest, _request.position, _request.functionCallDataList);

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
    ) external payable onlyOwner {
        (uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) =
            closePositionInternal(_unwrapWETH, _interest, _position, _swapFunctions);
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

    function closePositionInternal(
        bool _unwrapWETH,
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
        IWETH collateralToken = IWETH(
            _position.collateralCurrency == address(0)
                ? addressProvider.getWethAddress()
                : _position.collateralCurrency
        );

        uint256 collateralBalanceBefore = collateralToken.balanceOf(address(this));
        uint256 principalBalanceBefore = principalToken.balanceOf(address(this));

        // Sell tokens
        executeFunctions(_swapFunctions);

        // Principal paid is in currency
        principalRepaid = principalToken.balanceOf(address(this)) - principalBalanceBefore;

        // 1. Deduct interest
        (principalRepaid, interestPaid) = deduct(principalRepaid, _interest);

        // Payout and fees are paid in collateral
        (payout, ) = deduct(_position.collateralAmount, collateralBalanceBefore - collateralToken.balanceOf(address(this)));

        // 2. Deduct fees
        (payout, feeAmount) = deduct(payout, addressProvider.getFeeController().computeTradeFee(payout));

        if (principalRepaid < _position.principal) {
            if (payout > 0) revert InsufficientCollateralReceived();
            getVault(_position.currency).recordLoss(_position.principal - principalRepaid);
        } else {
            getVault(_position.currency).recordInterestEarned(interestPaid);
        }

        if (_unwrapWETH) {
            if (address(this).balance < payout + _position.feesToBePaid + feeAmount) {
                collateralToken.withdraw(payout + _position.feesToBePaid + feeAmount - address(this).balance);
            }

            payETH(payout, _position.trader);
            payETH(_position.feesToBePaid + feeAmount, addressProvider.getFeeController().getFeeReceiver());
        } else {
            collateralToken.safeTransfer(_position.trader, payout);
            collateralToken.safeTransfer(addressProvider.getFeeController().getFeeReceiver(), feeAmount + _position.feesToBePaid);
        }

        positions[_position.id] = bytes32(0);
    }
}