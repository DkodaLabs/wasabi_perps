// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "@openzeppelin/contracts/utils/Address.sol";

import "./Hash.sol";
import "./PerpUtils.sol";
import "./IWasabiPerps.sol";
import "./addressProvider/IAddressProvider.sol";
import "./vaults/IWasabiVault.sol";
import "./weth/IWETH.sol";

abstract contract BaseWasabiPool is IWasabiPerps, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, EIP712Upgradeable {
    using Address for address;
    using Hash for OpenPositionRequest;
    using SafeERC20 for IERC20;

    /// @notice indicates if this pool is an long pool
    bool public isLongPool;

    /// @notice the address provider
    IAddressProvider public addressProvider;

    /// @notice position id to hash
    mapping(uint256 => bytes32) public positions;

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
    ) internal {
        validateSignature(_request.hash(), _signature);
        if (positions[_request.id] != bytes32(0)) revert PositionAlreadyTaken();
        if (_request.functionCallDataList.length == 0) revert SwapFunctionNeeded();
        if (_request.expiration < block.timestamp) revert OrderExpired();
        if (isLongPool != isBaseToken(_request.currency)) revert InvalidCurrency();
        if (isLongPool == isBaseToken(_request.targetCurrency)) revert InvalidTargetCurrency();
        PerpUtils.receivePayment(
            isLongPool ? _request.currency : _request.targetCurrency,
            _request.downPayment + _request.fee,
            addressProvider.getWethAddress(),
            _msgSender()
        );
    }

    function recordRepayment(
        uint256 _principal,
        address _principalCurrency,
        uint256 _payout,
        uint256 _principalRepaid,
        uint256 _interestPaid
    ) internal {
        if (_principalRepaid < _principal) {
            if (_payout > 0) revert InsufficientCollateralReceived();
            getVault(_principalCurrency).recordLoss(_principal - _principalRepaid);
        } else {
            getVault(_principalCurrency).recordInterestEarned(_interestPaid);
        }
    }

    function payCloseAmounts(
        bool _unwrapWETH,
        IWETH token,
        address _trader,
        uint256 _payout,
        uint256 _pastFees,
        uint256 _closeFee
    ) internal {
        if (_unwrapWETH) {
            if (address(this).balance < _payout + _pastFees + _closeFee) {
                token.withdraw(_payout + _pastFees + _closeFee - address(this).balance);
            }

            PerpUtils.payETH(_payout, _trader);
            PerpUtils.payETH(_pastFees + _closeFee, addressProvider.getFeeController().getFeeReceiver());
        } else {
            if (_payout > 0) {
                token.transfer(_trader, _payout);
            }
            token.transfer(addressProvider.getFeeController().getFeeReceiver(), _closeFee + _pastFees);
        }
    }

    function computeInterest(Position calldata _position, uint256 _interest) internal view returns (uint256) {
        uint256 maxInterest = addressProvider.getDebtController()
            .computeMaxInterest(_position.currency, _position.principal, _position.lastFundingTimestamp);
        if (_interest == 0 || _interest > maxInterest) {
            _interest = maxInterest;
        }
        return _interest;
    }

    /// @notice returns {true} if the given token is a base token
    function isBaseToken(address _token) internal view returns(bool) {
        return baseTokens[_token];
    }

    /// @notice toggles a base token
    function toggleBaseToken(address _token, bool _isBaseToken) external onlyOwner {
        baseTokens[_token] = _isBaseToken;
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

    /// @inheritdoc IWasabiPerps
    function liquidatePosition(
        bool _unwrapWETH,
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions
    ) public virtual payable;

    /// @inheritdoc IWasabiPerps
    function liquidatePositions(
        bool _unwrapWETH,
        uint256[] calldata _interests,
        Position[] calldata _positions,
        FunctionCallData[][] calldata _swapFunctions
    ) external payable onlyOwner {
        if (_positions.length != _interests.length) revert InterestAmountNeeded();
        
        for (uint i = 0; i < _positions.length; i++) {
            liquidatePosition(_unwrapWETH, _interests[i], _positions[i], _swapFunctions[i]);
        }
    }

    /// @inheritdoc IWasabiPerps
    function withdraw(address _token, uint256 _amount, address _receiver) external {
        IWasabiVault vault = IWasabiVault(_msgSender());
        if (vault.getPoolAddress() != address(this) || vault.getAsset() != _token) revert InvalidVault();
        SafeERC20.safeTransfer(IERC20(_token), _receiver, _amount);
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

    receive() external payable virtual {}
}