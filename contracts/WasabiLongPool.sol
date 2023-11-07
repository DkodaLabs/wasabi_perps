// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "hardhat/console.sol";

import "./IWasabiPerps.sol";
import "./Hash.sol";
import "./DomainSigning.sol";
import "./debt/IDebtController.sol";
import "./fees/IFeeController.sol";

contract WasabiLongPool is IWasabiPerps, Ownable, IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Hash for Position;
    using Hash for OpenPositionRequest;
    using Hash for ClosePositionRequest;
    using Hash for FunctionCallData;
    using Hash for bytes32;
    using Address for address;

    bytes32 public immutable INITIAL_DOMAIN_SEPARATOR;
    bytes32 public immutable FILLED_ORDER = 0x0000000000000000000000000000000000000000000000000000000000000001;
    IDebtController public debtController;
    IFeeController public feeController;

    /// @notice position id to hash
    mapping(uint256 => bytes32) public positions;

    constructor(IDebtController _debtController, IFeeController _feeController) Ownable(msg.sender) payable {
        debtController = _debtController;
        feeController = _feeController;

        INITIAL_DOMAIN_SEPARATOR = _computeDomainSeparator();
    }

    function openPosition(
        OpenPositionRequest calldata _request,
        Signature calldata _signature
    ) external payable nonReentrant {
        // Validate Request
        require(positions[_request.id] == bytes32(0), 'Trade was already executed');
        require(verifySignature(_request.hash(), _signature), 'Invalid Order signature');
        require(_request.functionCallDataList.length > 0, 'Need to have swaps');
        require(_request.expiration >= block.timestamp, 'Order Expired');
        require(_request.currency == address(0), 'Invalid Currency');
        require(_request.targetCurrency != address(0), 'Invalid Target Currency');
        require(msg.value == _request.downPayment, 'Invalid Amount Provided');

        // Compute finalDownPayment amount after fees
        uint256 fee = feeController.computeTradeFee(_request.downPayment);
        uint256 downPayment = _request.downPayment - fee;

        // Validate principal
        uint256 maxPrincipal = debtController.computeMaxPrincipal(_request.targetCurrency, _request.currency, downPayment);
        require(maxPrincipal >= _request.principal, 'Principal is too high');

        require(address(this).balance - msg.value >= _request.principal, 'Insufficient balance for principal');

        IERC20 collateralToken = IERC20(_request.targetCurrency);
        uint256 balanceBefore = collateralToken.balanceOf(address(this));

        // Purchase target token
        executeFunctions(_request.functionCallDataList);

        uint256 collateralAmount = collateralToken.balanceOf(address(this)) - balanceBefore;
        require(collateralAmount >= _request.minTargetAmount, 'Insufficient Amount Bought');

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

    function closePosition(
        ClosePositionRequest calldata _request,
        Signature calldata _signature
    ) external payable nonReentrant {
        require(_request.position.trader == _msgSender(), 'Only position holder can close');
        verifySignature(_request.hash(), _signature);
        
        (uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) = closePositionInternal(_request.position, _request.functionCallDataList);

        emit ClosePosition(
            _request.position.id,
            _request.position.trader,
            payout,
            principalRepaid,
            interestPaid,
            feeAmount
        );
    }

    function liquidatePosition(
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) external payable onlyOwner {
        (uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) = closePositionInternal(_position, _swapFunctions);
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
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) internal returns(uint256 payout, uint256 principalRepaid, uint256 interestPaid, uint256 feeAmount) {
        require(positions[_position.id] == _position.hash(), 'Invalid position');
        require(_position.currency == address(0), 'Invalid Currency');
        require(_position.collateralCurrency != address(0), 'Invalid Target Currency');

        uint256 maxInterest = debtController.computeMaxInterest(_position.collateralCurrency, _position.principal, _position.lastFundingTimestamp);

        uint256 principalBalanceBefore = address(this).balance;

        // Sell tokens
        executeFunctions(_swapFunctions);

        payout = address(this).balance - principalBalanceBefore;

        // 1. Deduct principal
        (payout, principalRepaid) = deduct(payout, _position.principal);

        // 2. Deduct interest
        (payout, interestPaid) = deduct(payout, maxInterest);

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
    function executeFunctions(
        FunctionCallData[] memory _marketplaceCallData
    ) internal {
        uint256 length = _marketplaceCallData.length;
        for (uint256 i; i != length; ++i) {
            FunctionCallData memory functionCallData = _marketplaceCallData[i];
            functionCallData.to.functionCallWithValue(functionCallData.data, functionCallData.value);
        }
    }

    function verifySignature(bytes32 structHash, Signature calldata _signature) internal view returns (bool) {
        bytes32 typedDataHash = keccak256(abi.encodePacked("\x19\x01", INITIAL_DOMAIN_SEPARATOR, structHash));
        address signer = ecrecover(typedDataHash, _signature.v, _signature.r, _signature.s);
        return owner() == signer;
    }

    /// @notice Compute domain separator for EIP-712.
    /// @return The domain separator.
    function _computeDomainSeparator() private view returns (bytes32) {
        EIP712Domain memory domain = getDomainData();
        return
            keccak256(
                abi.encode(
                    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                    keccak256(bytes(domain.name)),
                    keccak256(bytes(domain.version)),
                    domain.chainId,
                    domain.verifyingContract
                )
            );
    }

    function getDomainData() public view returns (EIP712Domain memory) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return EIP712Domain({
            name: "WasabiPerps",
            version: "1",
            chainId: chainId,
            verifyingContract: address(this)
        });
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