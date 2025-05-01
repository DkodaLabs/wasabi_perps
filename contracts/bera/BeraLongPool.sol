// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "../WasabiLongPool.sol";
import "./IBeraPool.sol";
import "./IStakingAccountFactory.sol";

contract BeraLongPool is WasabiLongPool, IBeraPool {
    using SafeERC20 for IERC20;
    
    struct StakingStorage {
        mapping(uint256 => bool) isStaked;
    }

    // @notice The slot where the StakingStorage struct is stored
    // @dev This equals bytes32(uint256(keccak256("wasabi.bera.pool.staking_storage")) - 1)
    bytes32 private constant STAKING_STORAGE_SLOT = 0x0d8f064b21e6d7bd141e4ffc80d57d52569485729c3fe408a96c6787eff132d2;

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                        INITIALIZER                         */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @dev initializer for proxy
    /// @param _addressProvider address provider contract
    /// @param _manager the PerpManager contract
    function initialize(IAddressProvider _addressProvider, PerpManager _manager) public override initializer {
        __BaseWasabiPool_init(true, _addressProvider, _manager);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                           WRITES                           */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @inheritdoc IBeraPool
    function openPositionAndStake(
        OpenPositionRequest calldata _request, 
        Signature calldata _signature
    ) external payable returns (Position memory) {
        return openPositionAndStakeFor(_request, _signature, msg.sender);
    }

    /// @inheritdoc IBeraPool
    function openPositionAndStakeFor(
        OpenPositionRequest calldata _request,
        Signature calldata _signature,
        address _trader
    ) public payable returns (Position memory) {
        Position memory position = openPositionFor(_request, _signature, _trader);
        _stake(position);
        return position;
    }

    function stakePosition(Position memory _position) external payable {
        if (_position.trader != msg.sender) revert CallerNotTrader();
        _stake(_position);
    }

    /*´:°•.°+.*•´.*:˚.°*.˚•´.°:°•.°•.*•´.*:˚.°*.˚•´.°:°•.°+.*•´.*:*/
    /*                      INTERNAL FUNCTIONS                    */
    /*.•°:°.´+˚.*°.˚:*.´•*.+°.•°:´*.´•*.•°.•°:°.´:•˚°.*°.˚:*.´+°.•*/

    /// @dev Closes a given position
    /// @param _payoutType whether to send WETH to the trader, send ETH, or deposit WETH to the vault
    /// @param _interest the interest amount to be paid
    /// @param _position the position
    /// @param _swapFunctions the swap functions
    /// @param _executionFee the execution fee
    /// @param _isLiquidation flag indicating if the close is a liquidation
    /// @return closeAmounts the close amounts
    function _closePositionInternal(
        PayoutType _payoutType,
        uint256 _interest,
        Position calldata _position,
        FunctionCallData[] calldata _swapFunctions,
        uint256 _executionFee,
        bool _isLiquidation
    ) internal override returns(CloseAmounts memory closeAmounts) {
        _unstakeIfStaked(_position);
        return super._closePositionInternal(_payoutType, _interest, _position, _swapFunctions, _executionFee, _isLiquidation);
    }

    /// @dev Stakes the collateral of a given position via the staking account factory
    /// @param _position the position to stake
    function _stake(Position memory _position) internal {
        StakingStorage storage $ = _getStakingStorage();
        if ($.isStaked[_position.id]) revert PositionAlreadyStaked(_position.id);

        IStakingAccountFactory factory = _getStakingAccountFactory();
        IERC20(_position.collateralCurrency).forceApprove(address(factory), _position.collateralAmount);
        
        factory.stakePosition(_position);
        $.isStaked[_position.id] = true;
    }

    /// @dev Unstakes the collateral of a given position via the staking account factory if it is staked
    /// @param _position the position to unstake
    function _unstakeIfStaked(Position memory _position) internal {
        StakingStorage storage $ = _getStakingStorage();
        if ($.isStaked[_position.id]) {
            _getStakingAccountFactory().unstakePosition(_position);
            $.isStaked[_position.id] = false;
        }
    }

    /// @dev Returns the staking account factory from the address provider
    /// @return factory the staking account factory
    function _getStakingAccountFactory() internal view returns (IStakingAccountFactory) {
        return IStakingAccountFactory(addressProvider.getStakingAccountFactory());
    }

    /// @dev Returns the staking storage struct
    /// @return $ the staking storage
    function _getStakingStorage() internal pure returns (StakingStorage storage $) {
        assembly {
            $.slot := STAKING_STORAGE_SLOT
        }
    }
}
