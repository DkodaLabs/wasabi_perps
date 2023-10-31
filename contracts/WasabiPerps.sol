// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Address.sol";
// import "hardhat/console.sol";

import "./IWasabiPerps.sol";
import "./Hash.sol";
import "./DomainSigning.sol";
import "./debt/IDebtController.sol";

contract WasabiPerps is IWasabiPerps, Ownable, IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using Hash for Position;
    using Hash for OpenPositionRequest;
    using Hash for FunctionCallData;
    using Hash for bytes32;
    using Address for address;

    uint256 public constant FEE_DENOMINATOR = 10_000;

    bytes32 public immutable INITIAL_DOMAIN_SEPARATOR;
    IDebtController public debtController;
    uint256 public feeValue;

    /// @notice position id to hash
    mapping(uint256 => bytes32) public positions;

    uint256 public maxLeverage;

    constructor(IDebtController _debtController, uint256 _feeValue) Ownable(msg.sender) payable {
        debtController = _debtController;
        feeValue = _feeValue;
        INITIAL_DOMAIN_SEPARATOR = _computeDomainSeparator();
    }

    function openPosition(
        OpenPositionRequest calldata _request,
        Signature calldata _signature
    ) external payable nonReentrant {
        require(_request.expiration >= block.timestamp, 'Order Expired');

        uint256 downPayment = _request.downPayment - computeFeeValue(_request.downPayment);
        uint256 maxPrincipal = debtController.computeMaxPrincipal(_request.targetCurrency, _request.currency, downPayment);

        require(_request.principal <= maxPrincipal, 'Principal is too high');
        require(positions[_request.id] == bytes32(0), 'Trade was already executed');
        require(_request.functionCallDataList.length > 0, 'Need to have swaps');

        // require(verifySignature(_request.hash(), _signature), 'Invalid Order signature');

        if (_request.currency == address(0)) {
            require(msg.value == _request.downPayment, 'Invalid Amount Provided');
            require(address(this).balance >= _request.principal, 'Insufficient balance for principal');
        } else {
            IERC20 principaToken = IERC20(_request.currency);
            principaToken.safeTransferFrom(_msgSender(), address(this), _request.downPayment);
            require(principaToken.balanceOf(address(this)) >= _request.principal, 'Insufficient balance for principal');
        }

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
            collateralAmount
        );

        positions[_request.id] = position.hash();

        emit OpenPosition(
            _request.id,
            position.trader,
            position.currency,
            position.collateralCurrency,
            position.downPayment,
            position.principal,
            position.collateralAmount
        );
    }

    function closePosition(
        ClosePositionRequest calldata _request
    ) external payable nonReentrant {
        require(_request.position.trader == _msgSender(), 'Only position holder can close');
        
        (uint256 payout, uint256 repayAmount, uint256 feeAmount) = closePositionInternal(_request.position, _request.functionCallDataList);

        emit ClosePosition(
            _request.position.id,
            _request.position.trader,
            payout,
            repayAmount,
            feeAmount
        );
    }

    function liquidatePosition(
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) external payable onlyOwner {
        (uint256 payout, uint256 repayAmount, uint256 feeAmount) = closePositionInternal(_position, _swapFunctions);
        uint256 liquidationThreshold = _position.principal * 5 / 100;
        require(payout > liquidationThreshold, "Liquidation threshold not reached");

        emit PositionLiquidated(
            _position.id,
            _position.trader,
            payout,
            repayAmount,
            feeAmount
        );
    }

    function closePositionInternal(
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) internal returns(uint256 payout, uint256 repayAmount, uint256 feeAmount) {
        require(positions[_position.id] == _position.hash(), 'Invalid position');

        // IERC20 collateral = IERC20(_position.collateralCurrency);
        // uint256 collateralBalanceBefore = collateral.balanceOf(address(this));
        uint256 principalBalanceBefore =
            _position.currency == address(0) 
                ? address(this).balance
                : IERC20(_position.currency).balanceOf(address(this));

        // Sell tokens
        executeFunctions(_swapFunctions);

        uint256 maxDebt = debtController.computeMaxDebt(_position.collateralCurrency, _position.currency, _position.principal, _position.lastFundingTimestamp);

        uint256 totalReceived;
        payout = 0;
        if (_position.currency == address(0)) {
            totalReceived = address(this).balance - principalBalanceBefore;

            if (totalReceived > maxDebt) {
                payout = totalReceived - maxDebt;
                feeAmount = computeFeeValue(payout);
                payout = payout - feeAmount;
                payETH(payout, _position.trader);
            }
        } else {
            IERC20 principalToken = IERC20(_position.currency);
            totalReceived = principalToken.balanceOf(address(this)) - principalBalanceBefore;

            if (totalReceived > maxDebt) {
                payout = totalReceived - maxDebt;
                feeAmount = computeFeeValue(payout);
                payout = payout - feeAmount;
                principalToken.safeTransferFrom(address(this), _msgSender(), payout);
            }
        }
        repayAmount = totalReceived - payout;
        positions[_position.id] = bytes32(0);
    }

    function payETH(uint256 _amount, address target) private {
        (bool sent, ) = payable(target).call{value: _amount}("");
        if (!sent) {
            revert EthTransferFailed();
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
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return
            keccak256(
                abi.encode(
                    keccak256(
                        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                    ),
                    keccak256(bytes("WasabiPerps")),
                    keccak256("1"),
                    0,
                    address(this)
                )
            );
    }

    /// @notice sets the debt controller
    /// @param _debtController the debt controller
    function setDebtController(IDebtController _debtController) external onlyOwner {
        debtController = _debtController;
    }

    /// @notice computes the fee amount for the given amount
    /// @param _amount the total amount
    function computeFeeValue(uint256 _amount) internal view returns (uint256) {
        return _amount * feeValue / FEE_DENOMINATOR;
    }

    receive() external payable virtual {}

    fallback() external payable {
        require(false, "No fallback");
    }
}