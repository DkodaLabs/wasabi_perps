# Wasabi Perps

Wasabi Perps are mainnet fully collateralized perpetuals where users can long/short ERC20 tokens with leverage using ETH.

A user wanting to open a position will leverage will supply some ETH, borrow ETH/ERC20 to get leverage for the long/short position. Once the borrowing is done, the funds will be used to swap tokens. The swapped amount will be locked in the pool as a collateral. The user can close their position at any given time for which the collateral will be sold the pay for the loan, interest, fees and trader payout.

## Trading

A trader can open a position with leverage. They will have to put up a downpayment and borrow funds from the pool for their leverad position. The interest for the loans will be calculated off-chain, based on the utilization rate and other market factors.

### Long
For Long positions, the trader will borrow ETH. 

$LongPrincipal = (Leverage - 1) * DownPayment$

Then the downpayment and the principal will be used to purchase ERC20 tokens. These tokens will represent the whole position and also used as collateral for the loan.

### Short
For Short positions, the trader will borrow ERC20 tokens.  

$ShortPrincipal = Leverage * DownPayment * MarkPrice$

These tokens will be sold to the market. The ETH received and the downpayment will represent the position size and also used as collateral for the loan.

### Closing Positions
When a position is being closed, the collateral will be swapped to pay for principal, interest and fees.

For Long Pools, the full collateral will be sold. The debt and the payout will be in ETH.

For the short pool, some part of the collateral will be used to purchase back the principal ERC20 tokens. The interest, fees and the payout will be paid in ETH.

### Liquidations

The positions are liquidatable by the protocol admin (owner) if the price reaches a certain threshold. The position will be closed and the collateral will be sold in order to pay of the loan, interest, fee and a refund to the trader (for the remaining amount, if any).

The liquidation transactions won't go through if the price isn't within the liquidation threshold.

## Interest Calculation
Interest calculation will be done by an off-chain server based on the utilization rate of the pool. The more borrowed, the higher the interest will be for everyone.

A trader will get a signed close position request which will include this interest value.

There is a on-chain maximum debt controller which limits the max interest a trader will pay.

## Index Price
WasabiPerps being fully collateralized, don't need to have an index price in order to operate. 

However, an off-chain server needs to monitor the current price in order to liquidate positions and not get into bad debt. The off-chain server will monitor both Uniswap pools of fractional NFT tokens and NFT marketplaces. This will create a more robust, and much less manipulatable liquidation mechanic.

## Setting Up
After cloning the project, install the packages by running.

```shell
npm install
```

## Testing
Tests are created by using Hardhat. To run the unit tests, call the following:

```shell
npx hardhat test
```