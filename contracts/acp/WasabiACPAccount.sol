// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/interfaces/IERC1271.sol";

import {IWasabiACPAccount} from "./IWasabiACPAccount.sol";
import {IWasabiACPAccountFactory} from "./IWasabiACPAccountFactory.sol";
import {IWasabiPerps} from "../IWasabiPerps.sol";
import {IWasabiVault} from "../vaults/IWasabiVault.sol";

contract WasabiACPAccount is IWasabiACPAccount, OwnableUpgradeable, ReentrancyGuardUpgradeable, IERC1271 {
    using SafeERC20 for IERC20;

    bytes4 private constant INVALID_SIGNATURE = bytes4(0xffffffff);

    address public accountFactory;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                         MODIFIERS                          */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @dev Checks if the caller is the account factory
    modifier onlyOwnerOrAgent() {
        if (msg.sender != owner() && msg.sender != _getWasabiAgent()) revert CallerNotOwnerOrAgent();
        _;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        INITIALIZER                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Initializes the account
    /// @param _accountHolder The account holder's address
    function initialize(address _accountHolder) external initializer {
        __Ownable_init(_accountHolder);
        __ReentrancyGuard_init();
        accountFactory = msg.sender;
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      TRADING FUNCTIONS                     */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IWasabiACPAccount
    function withdrawFunds(
        address _token,
        uint256 _amount
    ) external onlyOwnerOrAgent nonReentrant {
        uint256 balance = IERC20(_token).balanceOf(address(this));
        if (_amount == 0 || _amount > balance) {
            _amount = balance;
        }
        if (_amount == 0) revert InvalidAmount();
        IERC20(_token).safeTransfer(owner(), _amount);
    }

    /// @inheritdoc IWasabiACPAccount
    function openPosition(
        IWasabiPerps _pool,
        IWasabiPerps.OpenPositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature
    ) external onlyOwnerOrAgent nonReentrant {
        bool isLongPool = _pool.isLongPool();
        address paymentCurrency = isLongPool ? _request.currency : _request.targetCurrency;
        uint256 paymentAmount = _request.downPayment + _request.fee;

        IERC20(paymentCurrency).forceApprove(address(_pool), paymentAmount);

        _pool.openPosition(_request, _signature);
    }

    /// @inheritdoc IWasabiACPAccount
    function closePosition(
        IWasabiPerps _pool,
        IWasabiPerps.PayoutType _payoutType,
        IWasabiPerps.ClosePositionRequest calldata _request,
        IWasabiPerps.Signature calldata _signature
    ) external onlyOwnerOrAgent nonReentrant {
        _pool.closePosition(_payoutType, _request, _signature);

        bool isLongPool = _pool.isLongPool();
        address payoutCurrency = isLongPool ? _request.position.currency : _request.position.collateralCurrency;
        uint256 payout = IERC20(payoutCurrency).balanceOf(address(this));

        IERC20(payoutCurrency).safeTransfer(owner(), payout);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      EARNING FUNCTIONS                     */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IWasabiACPAccount
    function depositToVault(
        IWasabiVault _vault,
        uint256 _amount
    ) external onlyOwnerOrAgent nonReentrant {
        if (_amount == 0) revert InvalidAmount();
        
        IERC20(_vault.asset()).forceApprove(address(_vault), _amount);

        _vault.deposit(_amount, address(this));
    }

    /// @inheritdoc IWasabiACPAccount
    function withdrawFromVault(
        IWasabiVault _vault,
        uint256 _amount
    ) external onlyOwnerOrAgent nonReentrant {
        uint256 maxWithdraw = _vault.maxWithdraw(address(this));
        if (_amount == 0 || _amount > maxWithdraw) {
            _amount = maxWithdraw;
        }
        if (_amount == 0) revert InvalidAmount();

        _vault.withdraw(_amount, owner(), address(this));
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                    VALIDATION FUNCTIONS                    */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IERC1271
    function isValidSignature(bytes32 hash, bytes memory signature)
        external
        view
        override
        returns (bytes4)
    {
        address recovered = _recover(hash, signature);
        if (recovered == owner() || recovered == _getWasabiAgent()) {
            return IERC1271.isValidSignature.selector;
        }
        return INVALID_SIGNATURE;
    }

    /// @dev Internal helper to recover signer address from a standard 65-byte signature
    function _recover(bytes32 hash, bytes memory signature) internal pure returns (address signer) {
        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := mload(add(signature, 0x20))
                s := mload(add(signature, 0x40))
                v := byte(0, mload(add(signature, 0x60)))
            }
            signer = ecrecover(hash, v, r, s);
        } else if (signature.length == 64) {
            bytes32 r;
            bytes32 vs;
            assembly {
                r := mload(add(signature, 0x20))
                vs := mload(add(signature, 0x40))
            }
            bytes32 s = vs & bytes32(0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
            uint8 v = uint8((uint256(vs) >> 255) + 27);
            signer = ecrecover(hash, v, r, s);
        } else {
            revert("InvalidSignatureLength");
        }
    }

    function _getWasabiAgent() internal view returns (address) {
        return IWasabiACPAccountFactory(accountFactory).wasabiAgent();
    }
}