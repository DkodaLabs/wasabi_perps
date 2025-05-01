import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import hre from "hardhat";
import { expect } from "chai";
import { parseEther, zeroAddress, maxUint256 } from "viem";
import { deployLongPoolMockEnvironment } from "./berachainFixtures";
import { getBalance, takeBalanceSnapshot } from "../utils/StateUtils";
import { PayoutType } from "../utils/PerpStructUtils";
import { getApproveAndSwapFunctionCallData } from "../utils/SwapUtils";

describe("BeraLongPool", function () {
    describe("Deployment", function () {
        it("Should deploy StakingAccountFactory correctly", async function () {
            const { addressProvider, stakingAccountFactory, beacon, ibgt, ibgtInfraredVault } = await loadFixture(deployLongPoolMockEnvironment);

            expect(await addressProvider.read.getStakingAccountFactory()).to.equal(stakingAccountFactory.address);
            expect(await stakingAccountFactory.read.beacon()).to.equal(beacon.address);
            expect(await stakingAccountFactory.read.stakingTokenToVault([ibgt.address])).to.equal(ibgtInfraredVault.address);
        });

        it("Should deploy StakingAccount correctly", async function () {
            const { user1, user2, stakingAccountFactory, sendStakingOpenPositionRequest } = await loadFixture(deployLongPoolMockEnvironment);

            expect(await stakingAccountFactory.read.userToStakingAccount([user1.account.address])).to.equal(zeroAddress);
            expect(await stakingAccountFactory.read.userToStakingAccount([user2.account.address])).to.equal(zeroAddress);

            // Test deploying a staking account while opening a position
            await sendStakingOpenPositionRequest();

            const user1StakingAccountAddress = await stakingAccountFactory.read.userToStakingAccount([user1.account.address]);
            expect(user1StakingAccountAddress).to.not.equal(zeroAddress);

            // Test deploying a staking account directly
            await stakingAccountFactory.write.getOrCreateStakingAccount([user2.account.address]);

            const user2StakingAccountAddress = await stakingAccountFactory.read.userToStakingAccount([user2.account.address]);
            expect(user2StakingAccountAddress).to.not.equal(zeroAddress);
        });
    });

    describe("Open Position w/ Leveraged Staking", function () {
        it("Should stake a position", async function () {
            const { user1, wasabiLongPool, stakingAccountFactory, sendStakingOpenPositionRequest, openPositionRequest, totalAmountIn, ibgt, ibgtInfraredVault, ibgtRewardVault } = await loadFixture(deployLongPoolMockEnvironment);

            const { position } = await sendStakingOpenPositionRequest();

            const positionOpenedEvents = await wasabiLongPool.getEvents.PositionOpened();
            expect(positionOpenedEvents).to.have.lengthOf(1);
            const positionOpenedEvent = positionOpenedEvents[0].args;

            expect(positionOpenedEvent.positionId).to.equal(openPositionRequest.id);
            expect(positionOpenedEvent.downPayment).to.equal(totalAmountIn - positionOpenedEvent.feesToBePaid!);
            expect(positionOpenedEvent.principal).to.equal(openPositionRequest.principal);
            expect(positionOpenedEvent.collateralAmount).to.equal(await ibgt.read.balanceOf([ibgtRewardVault.address]));
            expect(positionOpenedEvent.collateralAmount).to.greaterThanOrEqual(openPositionRequest.minTargetAmount);

            const user1StakingAccountAddress = await stakingAccountFactory.read.userToStakingAccount([user1.account.address]);
            expect(user1StakingAccountAddress).to.not.equal(zeroAddress);

            const stakedEvents = await ibgtInfraredVault.getEvents.Staked();
            expect(stakedEvents).to.have.lengthOf(1);
            const stakedEvent = stakedEvents[0].args;

            expect(stakedEvent.amount).to.equal(positionOpenedEvent.collateralAmount);
            expect(stakedEvent.user).to.equal(user1StakingAccountAddress);

            expect(await wasabiLongPool.read.isPositionStaked([position.id])).to.equal(true);
            expect(await ibgt.read.balanceOf([wasabiLongPool.address])).to.equal(0n);
        });

        it("Should stake a position after opening", async function () {
            const { user1, wasabiLongPool, stakingAccountFactory, sendDefaultOpenPositionRequest, openPositionRequest, totalAmountIn, ibgt, ibgtInfraredVault, ibgtRewardVault } = await loadFixture(deployLongPoolMockEnvironment);

            const { position } = await sendDefaultOpenPositionRequest();

            const positionOpenedEvents = await wasabiLongPool.getEvents.PositionOpened();
            expect(positionOpenedEvents).to.have.lengthOf(1);
            const positionOpenedEvent = positionOpenedEvents[0].args;

            expect(positionOpenedEvent.positionId).to.equal(openPositionRequest.id);
            expect(positionOpenedEvent.downPayment).to.equal(totalAmountIn - positionOpenedEvent.feesToBePaid!);
            expect(positionOpenedEvent.principal).to.equal(openPositionRequest.principal);
            expect(positionOpenedEvent.collateralAmount).to.equal(await ibgt.read.balanceOf([wasabiLongPool.address]));
            expect(positionOpenedEvent.collateralAmount).to.greaterThanOrEqual(openPositionRequest.minTargetAmount);
            
            await wasabiLongPool.write.stakePosition([position], { account: user1.account });

            const user1StakingAccountAddress = await stakingAccountFactory.read.userToStakingAccount([user1.account.address]);
            expect(user1StakingAccountAddress).to.not.equal(zeroAddress);

            const stakedEvents = await ibgtInfraredVault.getEvents.Staked();
            expect(stakedEvents).to.have.lengthOf(1);
            const stakedEvent = stakedEvents[0].args;

            expect(stakedEvent.amount).to.equal(positionOpenedEvent.collateralAmount);
            expect(stakedEvent.user).to.equal(user1StakingAccountAddress);

            expect(await wasabiLongPool.read.isPositionStaked([position.id])).to.equal(true);
            expect(await ibgt.read.balanceOf([wasabiLongPool.address])).to.equal(0n);
            expect(await ibgt.read.balanceOf([ibgtRewardVault.address])).to.equal(position.collateralAmount);
        });
    });

    describe("Close Staked Position", function () {
        it("Price Not Changed", async function () {
            const { user1, wasabiLongPool, sendStakingOpenPositionRequest, createSignedClosePositionRequest, computeMaxInterest, wbera, ibgt, ibgtRewardVault, vault, feeReceiver, publicClient } = await loadFixture(deployLongPoolMockEnvironment);

            const { position } = await sendStakingOpenPositionRequest();
            
            await time.increase(86400n); // 1 day later

            const { request, signature } = await createSignedClosePositionRequest({ position, interest: 0n });

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceBefore = await getBalance(publicClient, wbera.address, vault.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const maxInterest = await computeMaxInterest(position);
            
            const hash = await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceAfter = await getBalance(publicClient, wbera.address, vault.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(closePositionEvent.interestPaid!).to.equal(maxInterest, "If given interest value is 0, should use max interest");
            expect(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!).to.equal(vaultBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(0, "Total return should be 0 on no price change");

            expect(await wasabiLongPool.read.isPositionStaked([position.id])).to.equal(false, "Position should not be staked");
            expect(await ibgt.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");
            expect(await ibgt.read.balanceOf([ibgtRewardVault.address])).to.equal(0n, "Reward vault should not have any staked collateral left");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        it("Price Increased", async function () {
            const { sendStakingOpenPositionRequest, createSignedClosePositionRequest, owner, publicClient, wasabiLongPool, user1, ibgt, ibgtRewardVault, mockSwap, feeReceiver, initialPrice, wbera, vault } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendStakingOpenPositionRequest();

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([ibgt.address, wbera.address, initialPrice * 2n]); // Price doubled

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({position});

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceBefore = await getBalance(publicClient, wbera.address, vault.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceAfter = await getBalance(publicClient, wbera.address, vault.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!).to.equal(vaultBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount!;
            expect(totalReturn).to.equal(position.downPayment * 5n, "on 2x price increase, total return should be 4x down payment");

            expect(await ibgt.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");
            expect(await ibgt.read.balanceOf([ibgtRewardVault.address])).to.equal(0n, "Reward vault should not have any staked collateral left");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        it("Price Decreased", async function () {
            const { sendStakingOpenPositionRequest, createSignedClosePositionRequest, publicClient, wasabiLongPool, user1, ibgt, ibgtRewardVault, mockSwap, feeReceiver, initialPrice, wbera, vault } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendStakingOpenPositionRequest();

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([ibgt.address, wbera.address, initialPrice * 8n / 10n]); // Price fell 20%

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({position});

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceBefore = await getBalance(publicClient, wbera.address, vault.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceAfter = await getBalance(publicClient, wbera.address, vault.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!).to.equal(vaultBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(position.downPayment / -5n * 4n, "on 20% price decrease, total return should be -20% * leverage (4) * down payment");

            expect(await ibgt.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");
            expect(await ibgt.read.balanceOf([ibgtRewardVault.address])).to.equal(0n, "Reward vault should not have any staked collateral left");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });
    });

    describe("Liquidate Staked Position", function () {
        it("Liquidate", async function () {
            const { sendStakingOpenPositionRequest, computeMaxInterest, vault, publicClient, wasabiLongPool, user1, ibgt, ibgtRewardVault, mockSwap, feeReceiver, liquidationFeeReceiver, wbera, liquidator, computeLiquidationPrice } = await loadFixture(deployLongPoolMockEnvironment);
            // Open Position
            const {position} = await sendStakingOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Liquidate Position
            const functionCallDataList = getApproveAndSwapFunctionCallData(mockSwap.address, ibgt.address, wbera.address, position.collateralAmount);

            const interest = await computeMaxInterest(position);
            const liquidationPrice = await computeLiquidationPrice(position);

            // If the liquidation price is not reached, should revert
            await mockSwap.write.setPrice([ibgt.address, wbera.address, liquidationPrice + 1n]); 
            await expect(wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: liquidator.account }))
                .to.be.rejectedWith("LiquidationThresholdNotReached", "Cannot liquidate position if liquidation price is not reached");

            // Liquidate
            await mockSwap.write.setPrice([ibgt.address, wbera.address, liquidationPrice]); 

            const balancesBefore = await takeBalanceSnapshot(publicClient, wbera.address, vault.address, user1.account.address, feeReceiver, liquidationFeeReceiver);
            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });
            const liquidationFeeReceiverBalanceBefore = await publicClient.getBalance({address: liquidationFeeReceiver });            

            const hash = await wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: liquidator.account });

            const balancesAfter = await takeBalanceSnapshot(publicClient, wbera.address, vault.address, user1.account.address, feeReceiver);
            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });
            const liquidationFeeReceiverBalanceAfter = await publicClient.getBalance({address: liquidationFeeReceiver });
            // Checks
            const events = await wasabiLongPool.getEvents.PositionLiquidated();
            expect(events).to.have.lengthOf(1);
            const liquidatePositionEvent = events[0].args;
            const totalFeesPaid = liquidatePositionEvent.feeAmount! + position.feesToBePaid;

            expect(liquidatePositionEvent.id).to.equal(position.id);
            expect(liquidatePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await ibgt.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");
            expect(await ibgt.read.balanceOf([ibgtRewardVault.address])).to.equal(0n, "Reward vault should not have any staked collateral left");

            expect(balancesBefore.get(vault.address) + liquidatePositionEvent.principalRepaid! + liquidatePositionEvent.interestPaid!).to.equal(balancesAfter.get(vault.address)!);

            // Check trader has been paid
            expect(traderBalanceAfter - traderBalanceBefore).to.equal(liquidatePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);

            // Check liquidation fee receiver balance
            const liquidationFeeExpected = position.downPayment * 5n / 100n;
            expect(liquidationFeeReceiverBalanceAfter - liquidationFeeReceiverBalanceBefore).to.equal(liquidationFeeExpected);
        });

        it("Liquidate with no payout", async function () {
            const { sendStakingOpenPositionRequest, computeMaxInterest, wasabiLongPool, ibgt, mockSwap, wbera, liquidator, computeLiquidationPrice } = await loadFixture(deployLongPoolMockEnvironment);
            // Open Position
            const {position} = await sendStakingOpenPositionRequest();
    
            await time.increase(86400n); // 1 day later
    
            // Liquidate Position
            const functionCallDataList = getApproveAndSwapFunctionCallData(mockSwap.address, ibgt.address, wbera.address, position.collateralAmount);
    
            const interest = await computeMaxInterest(position);
            const liquidationPrice = await computeLiquidationPrice(position);
    
            // If the liquidation price is not reached, should revert
            await mockSwap.write.setPrice([ibgt.address, wbera.address, liquidationPrice + 1n]); 
            await expect(wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: liquidator.account }))
                .to.be.rejectedWith("LiquidationThresholdNotReached", "Cannot liquidate position if liquidation price is not reached");
    
            await mockSwap.write.setPrice([ibgt.address, wbera.address, liquidationPrice / 2n]); 
    
            await wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: liquidator.account });
            // Checks for no payout
            const events = await wasabiLongPool.getEvents.PositionLiquidated();
            expect(events).to.have.lengthOf(1);
            const liquidatePositionEvent = events[0].args;
            expect(liquidatePositionEvent.payout!).to.equal(0n);
        });
    });

    describe("Validations", function () {
        it("Cannot stake position for another user", async function () {
            const { sendStakingOpenPositionRequest, user2, wasabiLongPool } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendStakingOpenPositionRequest();

            await expect(wasabiLongPool.write.stakePosition([position], { account: user2.account }))
                .to.be.rejectedWith("CallerNotTrader", "Cannot stake position for another user");
        })

        it("Cannot stake position if already staked", async function () {
            const { sendStakingOpenPositionRequest, user1, wasabiLongPool } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendStakingOpenPositionRequest();

            await expect(wasabiLongPool.write.stakePosition([position], { account: user1.account }))
                .to.be.rejectedWith("PositionAlreadyStaked", "Cannot stake position if already staked");
        })
    });
});