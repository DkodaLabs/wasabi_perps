// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

interface IDebtController {
    error InvalidValue();
    error IdenticalAddresses();
    error ZeroAddress();

    /// @dev Returns the maximum apy
    /// @notice The maximum apy is a percentage, e.g. 300% APY = 300
    function maxApy() external view returns (uint256);

    /// @dev Returns the maximum leverage
    /// @notice The maximum leverage is a percentage, e.g. 3x leverage = 300
    function maxLeverage() external view returns (uint256);

    /// @dev Computes the maximum interest
    /// @param _tokenAddress the token address
    /// @param _principal the principal borrowed
    /// @param _lastFundingTimestamp the timestamp where the loan was last funded
    /// @return maxInterest the maximum interest amount to pay for the loan
    function computeMaxInterest(
        address _tokenAddress,
        uint256 _principal,
        uint256 _lastFundingTimestamp
    ) external view returns(uint256 maxInterest);

    /// @dev Computes the maximum principal
    /// @param _collateralToken the collateral token address
    /// @param _principalToken the principal token address
    /// @param _downPayment the down payment the trader is paying
    /// @return maxPrincipal the maximum principal allowed to be borrowed
    function computeMaxPrincipal(
        address _collateralToken,
        address _principalToken,
        uint256 _downPayment
    ) external view returns (uint256 maxPrincipal);

    /// @dev Returns the liquidation fee bps
    function liquidationFeeBps() external view returns (uint256);

    /// @dev Returns the liquidation fee for a given down payment
    function getLiquidationFee(uint256 _downPayment, address, address) external view returns (uint256);

    /// @dev Returns the liquidation threshold bps for a given token pair
    function getLiquidationThresholdBps(address _tokenA, address _tokenB) external view returns (uint256);

    /// @dev Returns the liquidation threshold for a given token pair and principal amount
    /// @param _tokenA the token A address
    /// @param _tokenB the token B address
    /// @param _size the size of the position
    /// @return the liquidation threshold
    function getLiquidationThreshold(address _tokenA, address _tokenB, uint256 _size) external view returns (uint256);

    /// @dev sets the maximum leverage
    /// @param _maxLeverage the max leverage 
    function setMaxLeverage(uint256 _maxLeverage) external;

    /// @dev sets the maximum apy
    /// @param _maxApy the max APY 
    function setMaxAPY(uint256 _maxApy) external;

    /// @dev sets the liquidation fee bps
    /// @param _liquidationFeeBps the liquidation fee bps
    function setLiquidationFeeBps(uint256 _liquidationFeeBps) external;

    /// @dev sets the liquidation threshold bps for a given token pair
    /// @param _tokenA the token A address
    /// @param _tokenB the token B address
    /// @param _liquidationThresholdBps the liquidation threshold bps
    function setLiquidationThresholdBps(address _tokenA, address _tokenB, uint256 _liquidationThresholdBps) external;
}