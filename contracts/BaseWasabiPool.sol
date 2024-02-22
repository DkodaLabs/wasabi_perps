// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

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
import "./admin/PerpManager.sol";
import "./admin/Roles.sol";

abstract contract BaseWasabiPool is IWasabiPerps, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, EIP712Upgradeable {
    using Address for address;
    using Hash for OpenPositionRequest;

    /// @dev indicates if this pool is an long pool
    bool public isLongPool;

    /// @dev the address provider
    IAddressProvider public addressProvider;

    /// @dev position id to hash
    mapping(uint256 => bytes32) public positions;

    /// @dev the ERC20 vaults
    mapping(address => address) public vaults;

    /// @dev the base tokens
    mapping(address => bool) public baseTokens;

    /**
     * @dev Checks if the caller has the correct role
     */
    modifier onlyRole(uint64 roleId) {
        _getManager().checkRole(roleId, msg.sender);
        _;
    }

    /**
     * @dev Checks if the caller is an admin
     */
    modifier onlyAdmin() {
        _getManager().isAdmin(msg.sender);
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Initializes the pool as per UUPSUpgradeable
    /// @param _isLongPool a flag indicating if this is a long pool or a short pool
    /// @param _addressProvider an address provider
    function __BaseWasabiPool_init(bool _isLongPool, IAddressProvider _addressProvider, PerpManager _manager) public onlyInitializing {
        __Ownable_init(address(_manager));
        __EIP712_init(_isLongPool ? "WasabiLongPool" : "WasabiShortPool", "1");
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        isLongPool = _isLongPool;
        addressProvider = _addressProvider;
        baseTokens[addressProvider.getWethAddress()] = true;
    }

    // @dev
    function migrateToRoleManager(PerpManager _adminManager) external onlyOwner {
        _transferOwnership(address(_adminManager));
    }

    function setAddressProvider(IAddressProvider _addressProvider) external onlyAdmin {
        addressProvider = _addressProvider;
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal view override onlyAdmin {}

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
    ) external payable onlyRole(Roles.LIQUIDATOR_ROLE) {
        uint256 length = _positions.length;
        if (length != _interests.length) revert InterestAmountNeeded();
        if (length != _swapFunctions.length) revert SwapFunctionNeeded();
        for (uint i = 0; i < length; ++i) {
            liquidatePosition(_unwrapWETH, _interests[i], _positions[i], _swapFunctions[i]);
        }
    }

    /// @inheritdoc IWasabiPerps
    function withdraw(address _token, uint256 _amount, address _receiver) external {
        IWasabiVault vault = getVault(_token);
        if (msg.sender != address(vault) ||
            vault.getPoolAddress() != address(this) ||
            vault.asset() != _token) revert InvalidVault();
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
    function addVault(IWasabiVault _vault) external onlyAdmin {
        if (_vault.getPoolAddress() != address(this)) revert InvalidVault();
        // Only long pool can have ETH vault
        if (_vault.asset() == addressProvider.getWethAddress() && !isLongPool) revert InvalidVault();
        if (vaults[_vault.asset()] != address(0)) revert VaultAlreadyExists();
        vaults[_vault.asset()] = address(_vault);
        emit NewVault(address(this), _vault.asset(), address(_vault));
    }

    /// @dev Records the repayment of a position
    /// @param _principal the principal
    /// @param _principalCurrency the principal currency
    /// @param _payout payout amount
    /// @param _principalRepaid principal amount repaid
    /// @param _interestPaid interest amount paid
    function _recordRepayment(
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

    /// @dev Pays the close amounts to the trader and the fee receiver
    /// @param _unwrapWETH flag indicating if the payments should be unwrapped
    /// @param token the token
    /// @param _trader the trader
    /// @param _payout the payout
    /// @param _pastFees past fee amounts to pay
    /// @param _closeFee the closing fee amount to pay
    function _payCloseAmounts(
        bool _unwrapWETH,
        IWETH token,
        address _trader,
        uint256 _payout,
        uint256 _pastFees,
        uint256 _closeFee
    ) internal {
        if (_unwrapWETH) {
            uint256 total = _payout + _pastFees + _closeFee;
            if (total > address(this).balance) {
                token.withdraw(total - address(this).balance);
            }
            PerpUtils.payETH(_pastFees + _closeFee, addressProvider.getFeeReceiver());
            PerpUtils.payETH(_payout, _trader);
        } else {
            SafeERC20.safeTransfer(token, addressProvider.getFeeReceiver(), _closeFee + _pastFees);
            if (_payout > 0) {
                SafeERC20.safeTransfer(token, _trader, _payout);
            }
        }
    }

    /// @dev Computes the interest to be paid
    /// @param _position the position
    /// @param _interest the interest amount
    function _computeInterest(Position calldata _position, uint256 _interest) internal view returns (uint256) {
        uint256 maxInterest = addressProvider.getDebtController()
            .computeMaxInterest(_position.currency, _position.principal, _position.lastFundingTimestamp);
        if (_interest == 0 || _interest > maxInterest) {
            _interest = maxInterest;
        }
        return _interest;
    }

    /// @dev Validates an open position request
    /// @param _request the request
    /// @param _signature the signature
    function _validateOpenPositionRequest(
        OpenPositionRequest calldata _request,
        Signature calldata _signature
    ) internal {
        _validateSignature(_request.hash(), _signature);
        if (positions[_request.id] != bytes32(0)) revert PositionAlreadyTaken();
        if (_request.functionCallDataList.length == 0) revert SwapFunctionNeeded();
        if (_request.expiration < block.timestamp) revert OrderExpired();
        if (isLongPool != _isBaseToken(_request.currency)) revert InvalidCurrency();
        if (isLongPool == _isBaseToken(_request.targetCurrency)) revert InvalidTargetCurrency();
        PerpUtils.receivePayment(
            isLongPool ? _request.currency : _request.targetCurrency,
            _request.downPayment + _request.fee,
            addressProvider.getWethAddress(),
            msg.sender
        );
    }

    /// @dev Checks if the signer for the given structHash and signature is the expected signer
    /// @param _structHash the struct hash
    /// @param _signature the signature
    function _validateSignature(bytes32 _structHash, IWasabiPerps.Signature calldata _signature) internal view {
        bytes32 typedDataHash = _hashTypedDataV4(_structHash);
        address signer = ecrecover(typedDataHash, _signature.v, _signature.r, _signature.s);

        (bool isValidSigner, ) = _getManager().hasRole(Roles.ORDER_SIGNER_ROLE, signer);
        if (!isValidSigner) {
            revert IWasabiPerps.InvalidSignature();
        }
    }

    /// @dev returns {true} if the given token is a base token
    function _isBaseToken(address _token) internal view returns(bool) {
        return baseTokens[_token];
    }

    // @dev returns the manager of the contract
    function _getManager() internal view returns (PerpManager) {
        return PerpManager(owner());
    }

    receive() external payable virtual {}
}