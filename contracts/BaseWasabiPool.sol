// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";


import "./Hash.sol";
import "./IWasabiPerps.sol";
import "./addressProvider/IAddressProvider.sol";
import "./vaults/IWasabiVault.sol";
import "./weth/IWETH.sol";

abstract contract BaseWasabiPool is IWasabiPerps, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, EIP712Upgradeable, IERC721Receiver {
    using Address for address;
    using Hash for OpenPositionRequest;
    using Hash for ClosePositionRequest;
    using SafeERC20 for IERC20;

    /// @notice indicates if this pool is an long pool
    bool public isLongPool;

    /// @notice the address provider
    IAddressProvider public addressProvider;

    /// @notice position id to hash
    mapping(uint256 => bytes32) public positions;

    /// @notice the ETH vault
    /// TODO: delete
    address public ethVault;

    /// @notice the ERC20 vaults
    mapping(address => address) public vaults;

    /// @notice the base tokens
    mapping(address => bool) public baseTokens;

    /// @notice Initializes the pool as per UUPSUpgradeable
    /// @param _isLongPool a flag indicating if this is a long pool or a short pool
    /// @param _addressProvider an address provider
    function __BaseWasabiPool_init(bool _isLongPool, IAddressProvider _addressProvider) public onlyInitializing {
        __Ownable_init(msg.sender);
        __EIP712_init(_isLongPool ? "WasabiLongPool" : "WasabiShortPool", "1");
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        isLongPool = _isLongPool;
        addressProvider = _addressProvider;
        baseTokens[addressProvider.getWethAddress()] = true;
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// @notice sets the address provider
    /// @param _addressProvider the address provider
    function setAddressProvider(IAddressProvider _addressProvider) public onlyOwner {
        addressProvider = _addressProvider;
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
            if (!isBaseToken(_request.currency)) revert InvalidCurrency();
            if (isBaseToken(_request.targetCurrency)) revert InvalidTargetCurrency();
        } else {
            if (isBaseToken(_request.currency)) revert InvalidCurrency();
            if (!isBaseToken(_request.targetCurrency)) revert InvalidTargetCurrency();
        }
        if (msg.value != _request.downPayment) revert InsufficientAmountProvided();
    }

    /// @notice returns {true} if the given token is a base token
    function isBaseToken(address _token) internal view returns(bool) {
        return baseTokens[_token] || _token == address(0);
    }

    /// @notice toggles a base token
    function toggleBaseToken(address _token, bool _isBaseToken) external onlyOwner {
        baseTokens[_token] = _isBaseToken;
    }

    /// @notice Generates a type hash for a open position request
    function getTypedDataHash_OpenPositionRequest(OpenPositionRequest calldata _request) public view returns (bytes32) {
        return _hashTypedDataV4(_request.hash());
    }

    /// @notice Generates a type hash for a close position request
    function getTypedDataHash_ClosePositionRequest(ClosePositionRequest calldata _request) public view returns (bytes32) {
        return _hashTypedDataV4(_request.hash());
    }

    /// @notice Checks if the signer for the given structHash and signature is the expected signer
    /// @param _structHash the struct hash
    /// @param _signature the signature
    function validateSignature(bytes32 _structHash, IWasabiPerps.Signature calldata _signature) internal view {
        bytes32 typedDataHash = _hashTypedDataV4(_structHash);
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
    /// @param _target The address to pay to
    function payETH(uint256 _amount, address _target) internal {
        if (_amount > 0) {
            (bool sent, ) = payable(_target).call{value: _amount}("");
            if (!sent) {
                revert EthTransferFailed(_amount, _target);
            }
        }
    }

    /// @dev Withdraws any stuck ERC721 in this contract
    function withdrawERC721(
        IERC721 _token,
        uint256 _tokenId
    ) external onlyOwner {
        _token.safeTransferFrom(address(this), owner(), _tokenId);
    }

    /// @inheritdoc IWasabiPerps
    function withdraw(address _token, uint256 _amount, address _receiver) external {
        IWasabiVault vault = IWasabiVault(_msgSender());
        if (vault.getPoolAddress() != address(this) || vault.getAsset() != _token) revert InvalidVault();

        if (_token == addressProvider.getWethAddress()) {
            payETH(_amount, _receiver);
        } else {
            IERC20(_token).safeTransfer(_receiver, _amount);
        }
    }

    /// @inheritdoc IWasabiPerps
    function getVault(address _asset) public view returns (IWasabiVault) {
        if (_asset == address(0)) {
            _asset = addressProvider.getWethAddress();
        }
        if (vaults[_asset] == address(0)) revert InvalidVault();
        return IWasabiVault(vaults[_asset]);
    }

    /// @inheritdoc IWasabiPerps
    function addVault(IWasabiVault _vault) external onlyOwner {
        if (_vault.getPoolAddress() != address(this)) revert InvalidVault();
        // Only long pool can have ETH vault
        if (_vault.getAsset() == addressProvider.getWethAddress() && !isLongPool) revert InvalidVault();
        if (vaults[_vault.getAsset()] != address(0)) revert VaultAlreadyExists();
        vaults[_vault.getAsset()] = address(_vault);
        emit NewVault(address(this), _vault.getAsset(), address(_vault));
    }

    /// @inheritdoc IWasabiPerps
    function unwrapWETH() external {
        IWETH weth = IWETH(addressProvider.getWethAddress());
        weth.withdraw(weth.balanceOf(address(this)));
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