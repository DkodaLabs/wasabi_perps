// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/MulticallUpgradeable.sol";

import "@openzeppelin/contracts/utils/Address.sol";

import "./Hash.sol";
import "./PerpUtils.sol";
import "./IWasabiPerps.sol";
import "./addressProvider/IAddressProvider.sol";
import "./weth/IWETH.sol";
import "./admin/PerpManager.sol";
import "./admin/Roles.sol";

abstract contract BaseWasabiPoolV1 is IWasabiPerps, UUPSUpgradeable, OwnableUpgradeable, ReentrancyGuardUpgradeable, EIP712Upgradeable, MulticallUpgradeable {
    using Address for address;
    using SafeERC20 for IERC20;
    using Hash for OpenPositionRequest;

    /// @dev indicates if this pool is an long pool
    bool public isLongPool;

    /// @dev the address provider
    IAddressProvider public addressProvider;

    /// @dev position id to hash
    mapping(uint256 => bytes32) public positions;

    /// @dev the ERC20 vaults
    mapping(address => address) public vaults;

    /// @dev the quote tokens
    /// @custom:oz-renamed-from baseTokens
    mapping(address => bool) public quoteTokens;

    /// @dev magic bytes for closed position
    bytes32 internal constant CLOSED_POSITION_HASH = bytes32(uint256(1));

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
        quoteTokens[_getWethAddress()] = true;
    }

    function setAddressProvider(IAddressProvider _addressProvider) external onlyAdmin {
        addressProvider = _addressProvider;
    }

    /// @inheritdoc UUPSUpgradeable
    function _authorizeUpgrade(address) internal view override onlyAdmin {}

    /// @inheritdoc IWasabiPerps
    function withdraw(address _token, uint256 _amount, address _receiver) external virtual {
        IWasabiVault vault = getVault(_token);
        if (msg.sender != address(vault) ||
            vault.getPoolAddress() != address(this) ||
            vault.asset() != _token) revert InvalidVault();
        IERC20(_token).safeTransfer(_receiver, _amount);
    }

    /// @inheritdoc IWasabiPerps
    function donate(address token, uint256 amount) external virtual onlyAdmin {
        if (amount > 0) {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

            IWasabiVault vault = getVault(token);
            vault.recordInterestEarned(amount);

            emit NativeYieldClaimed(address(vault), token, amount);
        }
    }

    /// @inheritdoc IWasabiPerps
    function getVault(address _asset) public view returns (IWasabiVault) {
        if (_asset == address(0)) {
            _asset = _getWethAddress();
        }
        if (vaults[_asset] == address(0)) revert InvalidVault();
        return IWasabiVault(vaults[_asset]);
    }

    /// @inheritdoc IWasabiPerps
    function addVault(IWasabiVault _vault) external virtual onlyAdmin {
        if (_vault.getPoolAddress() != address(this)) revert InvalidVault();
        // Only long pool can have ETH vault
        address asset = _vault.asset();
        if (asset == _getWethAddress() && !isLongPool) revert InvalidVault();
        if (vaults[asset] != address(0)) revert VaultAlreadyExists();
        vaults[asset] = address(_vault);
        emit NewVault(address(this), asset, address(_vault));
    }

    /// @dev Records the repayment of a position
    /// @param _principal the principal
    /// @param _principalCurrency the principal currency
    /// @param _isLiquidation true if this is a liquidation
    /// @param _principalRepaid principal amount repaid
    /// @param _interestPaid interest amount paid
    function _recordRepayment(
        uint256 _principal,
        address _principalCurrency,
        bool _isLiquidation,
        uint256 _principalRepaid,
        uint256 _interestPaid
    ) internal virtual {
        if (_principalRepaid < _principal) {
            // Only liquidations can cause bad debt
            if (!_isLiquidation) revert InsufficientPrincipalRepaid();
            getVault(_principalCurrency).recordLoss(_principal - _principalRepaid);
        } else {
            getVault(_principalCurrency).recordInterestEarned(_interestPaid);
        }
    }

    /// @dev Pays the close amounts to the trader and the fee receiver
    /// @param _payoutType whether to send WETH to the trader, send ETH, or deposit tokens to the vault (if `_token != WETH` then `WRAPPED` and `UNWRAPPED` have no effect)
    /// @param _token the payout token (`currency` for longs, `collateralCurrency` for shorts)
    /// @param _trader the trader
    /// @param _closeAmounts the close amounts
    function _payCloseAmounts(
        PayoutType _payoutType,
        address _token,
        address _trader,
        CloseAmounts memory _closeAmounts
    ) internal virtual {
        uint256 positionFeesToTransfer = _closeAmounts.pastFees + _closeAmounts.closeFee;

        // Check if the payout token is ETH/WETH or another ERC20 token
        address wethAddress = _getWethAddress();
        if (_token == wethAddress) {
            uint256 total = _closeAmounts.payout + positionFeesToTransfer + _closeAmounts.liquidationFee;
            IWETH wethToken = IWETH(wethAddress);
            if (_payoutType == PayoutType.UNWRAPPED) {
                if (total > address(this).balance) {
                    wethToken.withdraw(total - address(this).balance);
                }
                PerpUtils.payETH(positionFeesToTransfer, _getFeeReceiver());

                if (_closeAmounts.liquidationFee > 0) { 
                    PerpUtils.payETH(_closeAmounts.liquidationFee, _getLiquidationFeeReceiver());
                }

                PerpUtils.payETH(_closeAmounts.payout, _trader);
                // Do NOT fall through to ERC20 transfer
                return;
            } else {
                uint256 balance = wethToken.balanceOf(address(this));
                if (total > balance) {
                    wethToken.deposit{value: total - balance}();
                }
                // Fall through to ERC20 transfer
            }
        }
        IERC20 token = IERC20(_token);
        token.safeTransfer(_getFeeReceiver(), positionFeesToTransfer);

        if (_closeAmounts.liquidationFee > 0) {
            token.safeTransfer(_getLiquidationFeeReceiver(), _closeAmounts.liquidationFee);
        }

        if (_closeAmounts.payout != 0) {
            if (_payoutType == PayoutType.VAULT_DEPOSIT) {
                IWasabiVault vault = getVault(address(token));
                if (token.allowance(address(this), address(vault)) < _closeAmounts.payout) {
                    token.approve(address(vault), type(uint256).max);
                }
                vault.deposit(_closeAmounts.payout, _trader);
            } else {
                token.safeTransfer(_trader, _closeAmounts.payout);
            }
        }
    }

    /// @dev Computes the interest to be paid
    /// @param _position the position
    /// @param _interest the interest amount
    function _computeInterest(Position calldata _position, uint256 _interest) internal view returns (uint256) {
        uint256 maxInterest = _getDebtController()
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
    ) internal virtual {
        _validateSignature(_request.hash(), _signature);
        if (positions[_request.id] != bytes32(0)) revert PositionAlreadyTaken();
        if (_request.functionCallDataList.length == 0) revert SwapFunctionNeeded();
        if (_request.expiration < block.timestamp) revert OrderExpired();
        if (isLongPool != _isQuoteToken(_request.currency)) revert InvalidCurrency();
        if (isLongPool == _isQuoteToken(_request.targetCurrency)) revert InvalidTargetCurrency();
        PerpUtils.receivePayment(
            isLongPool ? _request.currency : _request.targetCurrency,
            _request.downPayment + _request.fee,
            _getWethAddress(),
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

    /// @dev Checks if the signer for the given structHash and signature is the expected signer
    /// @param _signer the expected signer
    /// @param _structHash the struct hash
    /// @param _signature the signature
    function _validateSigner(address _signer, bytes32 _structHash, IWasabiPerps.Signature calldata _signature) internal view {
        bytes32 typedDataHash = _hashTypedDataV4(_structHash);
        address signer = ecrecover(typedDataHash, _signature.v, _signature.r, _signature.s);

        if (_signer != signer) {
            revert IWasabiPerps.InvalidSignature();
        }
    }

    /// @dev returns {true} if the given token is a quote token
    function _isQuoteToken(address _token) internal view returns(bool) {
        return quoteTokens[_token];
    }

    /// @dev computes the liquidation fee
    function _computeLiquidationFee(uint256 _downPayment) internal view returns (uint256) {
        uint256 liquidationFeeBps = addressProvider.getLiquidationFeeBps();
        return _downPayment * liquidationFeeBps / 10000;
    }

    /// @dev checks if the caller can close out the given trader's position
    function _checkCanClosePosition(address _trader) internal view {
        if (msg.sender == _trader) return;

        (bool isLiquidator, ) = _getManager().hasRole(Roles.LIQUIDATOR_ROLE, msg.sender);
        if (!isLiquidator) revert SenderNotTrader();
    }

    /// @dev returns the manager of the contract
    function _getManager() internal view returns (PerpManager) {
        return PerpManager(owner());
    }

    /// @dev returns the debt controller
    function _getDebtController() internal view returns (IDebtController) {
        return addressProvider.getDebtController();
    }

    /// @dev returns the WETH address
    function _getWethAddress() internal view returns (address) {
        return addressProvider.getWethAddress();
    }

    /// @dev returns the fee receiver
    function _getFeeReceiver() internal view returns (address) {
        return addressProvider.getFeeReceiver();
    }

    /// @dev returns the liquidation fee receiver
    function _getLiquidationFeeReceiver() internal view returns (address) {
        return addressProvider.getLiquidationFeeReceiver();
    }

    receive() external payable virtual {}
}