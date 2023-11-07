// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";

import "./IWasabiPerps.sol";
import "./Hash.sol";
import "./DomainSigning.sol";
import "./TypedDataValidator.sol";
import "./debt/IDebtController.sol";
import "./fees/IFeeController.sol";

contract WasabiLongPool is IWasabiPerps, TypedDataValidator, Ownable, IERC721Receiver, ReentrancyGuard {
    using Address for address;
    using SafeERC20 for IERC20;
    using Hash for Position;
    using Hash for OpenPositionRequest;
    using Hash for ClosePositionRequest;

    IDebtController public debtController;
    IFeeController public feeController;

    /// @notice position id to hash
    mapping(uint256 => bytes32) public positions;

    constructor(IDebtController _debtController, IFeeController _feeController) Ownable(msg.sender) TypedDataValidator("WasabiLongPool") payable {
        debtController = _debtController;
        feeController = _feeController;
    }

    /// @inheritdoc IWasabiPerps
    function openPosition(
        OpenPositionRequest calldata _request,
        Signature calldata _signature
    ) external payable nonReentrant {
        // Validate Request
        validateSignature(owner(), _request.hash(), _signature);
        if (positions[_request.id] != bytes32(0)) revert PositionAlreadyTaken();
        if (_request.functionCallDataList.length == 0) revert SwapFunctionNeeded();
        if (_request.expiration < block.timestamp) revert OrderExpired();
        if (_request.currency != address(0)) revert InvalidCurrency();
        if (_request.targetCurrency == address(0)) revert InvalidTargetCurrency();
        if (msg.value != _request.downPayment) revert InsufficientAmountProvided();

        // Compute finalDownPayment amount after fees
        uint256 fee = feeController.computeTradeFee(_request.downPayment);
        uint256 downPayment = _request.downPayment - fee;

        // Validate principal
        uint256 maxPrincipal = debtController.computeMaxPrincipal(_request.targetCurrency, _request.currency, downPayment);
        if (_request.principal > maxPrincipal) revert PrincipalTooHigh();
        if (address(this).balance - msg.value < _request.principal) revert InsufficientAvailablePrincipal();

        IERC20 collateralToken = IERC20(_request.targetCurrency);
        uint256 balanceBefore = collateralToken.balanceOf(address(this));

        // Purchase target token
        executeFunctions(_request.functionCallDataList);

        uint256 collateralAmount = collateralToken.balanceOf(address(this)) - balanceBefore;
        if (collateralAmount < _request.minTargetAmount) revert InsufficientCollateralReceived();

        Position memory position = Position(
            _request.id,
            _msgSender(),
            _request.currency,
            _request.targetCurrency,
            block.timestamp,
            downPayment,
            _request.principal,
            collateralAmount,
            fee
        );

        positions[_request.id] = position.hash();

        emit OpenPosition(
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
        validateSignature(owner(), _request.hash(), _signature);
        if (_request.position.trader != _msgSender()) revert SenderNotTrader();
        if (_request.expiration < block.timestamp) revert OrderExpired();
        
        (uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) =
            closePositionInternal(_request.interest, _request.position, _request.functionCallDataList);

        emit ClosePosition(
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
        uint256 liquidationThreshold = _position.principal * 5 / 100;
        if (payout > liquidationThreshold) {
            revert LiquidationThresholdNotReached();
        }

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

        // Not needed
        // require(_position.currency == address(0), 'Invalid Currency'); 
        // require(_position.collateralCurrency != address(0), 'Invalid Target Currency');

        uint256 maxInterest = debtController.computeMaxInterest(_position.collateralCurrency, _position.principal, _position.lastFundingTimestamp);
        if (_interest == 0 || _interest > maxInterest) {
            _interest = maxInterest;
        }

        uint256 principalBalanceBefore = address(this).balance;

        // Sell tokens
        executeFunctions(_swapFunctions);

        payout = address(this).balance - principalBalanceBefore;

        // 1. Deduct principal
        (payout, principalRepaid) = deduct(payout, _position.principal);

        // 2. Deduct interest
        (payout, interestPaid) = deduct(payout, _interest);

        // 3. Deduct fees
        (payout, feeAmount) = deduct(payout, feeController.computeTradeFee(payout));

        payETH(payout, _position.trader);
        payETH(_position.feesToBePaid + feeAmount, feeController.getFeeReceiver());

        positions[_position.id] = bytes32(0);
    }

    function deduct(uint256 _amount, uint256 deductAmount) internal pure returns(uint256 remaining, uint256 deducted) {
        if (_amount > deductAmount) {
            remaining = _amount - deductAmount;
            deducted = deductAmount;
        } else {
            remaining = 0;
            deducted = _amount;
        }
    }

    /// @dev Pays ETH to a given address
    /// @param _amount The amount to pay
    /// @param target The address to pay to
    function payETH(uint256 _amount, address target) private {
        if (_amount > 0) {
            (bool sent, ) = payable(target).call{value: _amount}("");
            if (!sent) {
                revert EthTransferFailed();
            }
        }
    }

    /// @dev Withdraws any stuck ETH in this contract
    function withdrawETH(uint256 _amount) external payable onlyOwner {
        if (_amount > address(this).balance) {
            _amount = address(this).balance;
        }
        payETH(_amount, owner());
    }

    /// @dev Withdraws any stuck ERC20 in this contract
    function withdrawERC20(IERC20 _token, uint256 _amount) external onlyOwner {
        _token.transfer(_msgSender(), _amount);
    }

    /// @dev Withdraws any stuck ERC721 in this contract
    function withdrawERC721(
        IERC721 _token,
        uint256 _tokenId
    ) external onlyOwner {
        _token.safeTransferFrom(address(this), owner(), _tokenId);
    }

    /**
     * @dev See {IERC721Receiver-onERC721Received}.
     *
     * Always returns `IERC721Receiver.onERC721Received.selector`.
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) public virtual override returns (bytes4) {
        return this.onERC721Received.selector;
    }
    
    /// @notice Executes a given list of functions
    /// @param _marketplaceCallData List of marketplace calldata
    function executeFunctions(FunctionCallData[] memory _marketplaceCallData) internal {
        uint256 length = _marketplaceCallData.length;
        for (uint256 i; i < length;) {
            FunctionCallData memory functionCallData = _marketplaceCallData[i];
            functionCallData.to.functionCallWithValue(functionCallData.data, functionCallData.value);
            unchecked {
                i++;
            }
        }
    }

    /// @notice sets the debt controller
    /// @param _debtController the debt controller
    function setDebtController(IDebtController _debtController) external onlyOwner {
        debtController = _debtController;
    }

    /// @notice sets the fee controller
    /// @param _feeController the fee controller
    function setFeeController(IFeeController _feeController) external onlyOwner {
        feeController = _feeController;
    }

    receive() external payable virtual {}

    fallback() external payable {
        require(false, "No fallback");
    }
}