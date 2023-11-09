// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

import "./Hash.sol";
import "./IWasabiPerps.sol";
import "./addressProvider/IAddressProvider.sol";

abstract contract BaseWasabiPool is Ownable, IWasabiPerps, IERC721Receiver {
    using Address for address;
    using Hash for OpenPositionRequest;
    
    /// @notice the domain separator for EIP712 signatures
    bytes32 public immutable INITIAL_DOMAIN_SEPARATOR;

    /// @notice indicates if this pool is an long pool
    bool public immutable isLongPool;

    /// @notice the address provider
    IAddressProvider public addressProvider;

    /// @notice position id to hash
    mapping(uint256 => bytes32) public positions;

    constructor(bool _isLongPool, IAddressProvider _addressProvider) Ownable(msg.sender) payable {
        isLongPool = _isLongPool;
        addressProvider = _addressProvider;

        INITIAL_DOMAIN_SEPARATOR = _computeDomainSeparator(_isLongPool ? "WasabiLongPool" : "WasabiShortPool");
    }

    /// @notice sets the address provider
    /// @param _addressProvider the address provider
    function setAddressProvider(IAddressProvider _addressProvider) external onlyOwner {
        addressProvider = _addressProvider;
    }
    
    /// @notice Compute domain separator for EIP-712.
    /// @return The domain separator.
    function _computeDomainSeparator(string memory name) private view returns (bytes32) {
        uint256 chainId;
        assembly {
            chainId := chainid()
        }
        return
            keccak256(
                abi.encode(
                    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                    keccak256(bytes(name)),
                    keccak256(bytes("1")),
                    chainId,
                    address(this)
                )
            );
    }

    /// @notice Validates an open position request
    /// @param _request the request
    /// @param _signature the signature
    function validateOpenPositionRequest(
        OpenPositionRequest calldata _request,
        Signature calldata _signature
    ) internal view {
        validateSignature(_request.hash(), _signature);
        if (positions[_request.id] != bytes32(0)) revert PositionAlreadyTaken();
        if (_request.functionCallDataList.length == 0) revert SwapFunctionNeeded();
        if (_request.expiration < block.timestamp) revert OrderExpired();
        if (isLongPool) {
            if (_request.currency != address(0)) revert InvalidCurrency();
            if (_request.targetCurrency == address(0)) revert InvalidTargetCurrency();
        } else {
            if (_request.currency == address(0)) revert InvalidCurrency();
            if (_request.targetCurrency != address(0)) revert InvalidTargetCurrency();
            if (_request.swapPrice == 0) revert IncorrectSwapParameter();
            if (_request.swapPriceDenominator == 0) revert IncorrectSwapParameter();
        }
        if (msg.value != _request.downPayment) revert InsufficientAmountProvided();
    }

    /// @notice Checks if the signer for the given structHash and signature is the expected signer
    /// @param _structHash the struct hash
    /// @param _signature the signature
    function validateSignature(bytes32 _structHash, IWasabiPerps.Signature calldata _signature) internal view {
        bytes32 typedDataHash = keccak256(abi.encodePacked("\x19\x01", INITIAL_DOMAIN_SEPARATOR, _structHash));
        address signer = ecrecover(typedDataHash, _signature.v, _signature.r, _signature.s);
        if (owner() != signer) {
            revert IWasabiPerps.InvalidSignature();
        }
    }

    /// @notice Deducts the given amount from the total amount
    /// @param _amount the amount to deduct from
    /// @param _deductAmount the amount to deduct
    /// @return remaining the remaining amount
    /// @return deducted the total deducted
    function deduct(uint256 _amount, uint256 _deductAmount) internal pure returns(uint256 remaining, uint256 deducted) {
        if (_amount > _deductAmount) {
            remaining = _amount - _deductAmount;
            deducted = _deductAmount;
        } else {
            remaining = 0;
            deducted = _amount;
        }
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


    /// @dev Pays ETH to a given address
    /// @param _amount The amount to pay
    /// @param target The address to pay to
    function payETH(uint256 _amount, address target) internal {
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

    receive() external payable virtual {}

    fallback() external payable {
        require(false, "No fallback");
    }
}