// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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

    bytes32 public immutable INITIAL_DOMAIN_SEPARATOR;
    IDebtController public debtController;

    /// @notice position id to hash
    mapping(uint256 => bytes32) public positions;

    uint256 public maxLeverage;

    constructor(IDebtController _debtController) Ownable(msg.sender) {
        debtController = _debtController;
        INITIAL_DOMAIN_SEPARATOR = _computeDomainSeparator();
    }


    function openPosition(
        OpenPositionRequest calldata _request,
        FunctionCallData[] calldata _swapFunctions,
        Signature calldata _signature
    ) external payable nonReentrant {
        require(_request.expiration < block.timestamp, 'Order Expired');

        uint256 maxPrincipal = debtController.computeMaxPrincipal(_request.targetCurrency, _request.currency, _request.downPayment);
        require(_request.principal <= maxPrincipal, 'Principal is too high');

        require(positions[_request.id] != bytes32(0), 'Trade was already executed');
        require(_swapFunctions.length > 1, 'Need to have swaps');

        bytes32 orderHash = _request.hash();
        require(verifySignature(orderHash.hashWithFunctionCallDataList(_swapFunctions), _signature), 'Invalid Order signature');

        positions[_request.id] = orderHash;

        if (_request.currency == address(0)) {
            require(msg.value == _request.downPayment + _request.fee, 'Invalid Amount Provided');
            require(address(this).balance >= _request.principal, 'Insufficient balance for principal');
        } else {
            IERC20 principaToken = IERC20(_request.currency);
            principaToken.safeTransferFrom(_msgSender(), address(this), _request.downPayment + _request.fee);
            require(principaToken.balanceOf(address(this)) >= _request.principal, 'Insufficient balance for principal');
        }

        IERC20 collateralToken = IERC20(_request.targetCurrency);
        uint256 balanceBefore = collateralToken.balanceOf(address(this));

        // Purchase target token
        executeFunctions(_swapFunctions);

        uint256 collateralAmount = collateralToken.balanceOf(address(this)) - balanceBefore;
        require(collateralAmount >= _request.minTargetAmount, 'Insufficient Amount Bought');

        emit OpenPosition(
            _msgSender(),
            _request.currency,
            _request.targetCurrency,
            _request.downPayment,
            _request.principal,
            collateralAmount
        );
    }

    function closePosition(
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) external payable nonReentrant {
        require(_position.trader == _msgSender(), 'Only position holder can close');
        
        (uint256 payout, uint256 repayAmount) = closePositionInternal(_position, _swapFunctions);

        emit ClosePosition(
            _position.id,
            _position.trader,
            payout,
            repayAmount
        );
    }

    function liquidatePosition(
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) external payable onlyOwner {
        (uint256 payout, uint256 repayAmount) = closePositionInternal(_position, _swapFunctions);
        uint256 liquidationThreshold = _position.principal * 5 / 100;
        require(payout > liquidationThreshold, "Liquidation threshold not reached");

        emit PositionLiquidated(
            _position.id,
            _position.trader,
            payout,
            repayAmount
        );
    }

    function closePositionInternal(
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) internal returns(uint256 payout, uint256 repayAmount) {
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
                payETH(payout, _position.trader);
            }
        } else {
            IERC20 principalToken = IERC20(_position.currency);
            totalReceived = principalToken.balanceOf(address(this)) - principalBalanceBefore;

            if (totalReceived > maxDebt) {
                payout = totalReceived - maxDebt;
                principalToken.safeTransferFrom(address(this), _msgSender(), payout);
            }
        }
        repayAmount = totalReceived - payout;
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
    ) internal returns (bool) {
        uint256 length = _marketplaceCallData.length;
        for (uint256 i; i != length; ++i) {
            FunctionCallData memory functionCallData = _marketplaceCallData[i];
            (bool success, ) = functionCallData.to.call{
                value: functionCallData.value
            }(functionCallData.data);
            if (success == false) {
                return false;
            }
        }
        return true;
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
                    chainId,
                    address(this)
                )
            );
    }

    /// @notice sets the debt controller
    /// @param _debtController the debt controller
    function setDebtController(IDebtController _debtController) external onlyOwner {
        debtController = _debtController;
    }
}