import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { getAddress, zeroAddress } from "viem";
import { getValueWithoutFee } from "./utils/PerpStructUtils";
import { getApproveAndSwapFunctionCallData } from "./utils/SwapUtils";
import { deployLongPoolMockEnvironment, deployShortPoolMockEnvironment, deployWasabiLongPool, deployWasabiShortPool } from "./fixtures";
import { getBalance, takeBalanceSnapshot } from "./utils/StateUtils";

describe.only("WasabiShortPool - Trade Flow Test", function () {
    describe("Deployment", function () {
        it("Should set the right address provider", async function () {
            const { wasabiShortPool, addressProvider } = await loadFixture(deployWasabiShortPool);
            expect(await wasabiShortPool.read.addressProvider()).to.equal(getAddress(addressProvider.address));
        });

        it("Should set the right owner", async function () {
            const { wasabiShortPool, owner } = await loadFixture(deployWasabiShortPool);
            expect(await wasabiShortPool.read.owner()).to.equal(getAddress(owner.account.address));
        });
    });

    describe("Open Position", function () {
        it("Open Position", async function () {
            const { wasabiShortPool, tradeFeeValue, publicClient, user1, openPositionRequest, downPayment, signature, wethAddress, mockSwap } = await loadFixture(deployShortPoolMockEnvironment);

            await wasabiShortPool.write.openPosition([openPositionRequest, signature], { account: user1.account });

            const events = await wasabiShortPool.getEvents.PositionOpened();
            expect(events).to.have.lengthOf(1);
            const event = events[0].args;
            expect(event.positionId).to.equal(openPositionRequest.id);
            expect(event.downPayment).to.equal(getValueWithoutFee(downPayment, tradeFeeValue));
            expect(event.collateralAmount! + event.feesToBePaid!).to.equal(await getBalance(publicClient, wethAddress, wasabiShortPool.address));
        });
    });

    describe("Close Position", function () {
        it("Price Not Changed", async function () {
            const { sendDefaultOpenPositionRequest, createClosePositionOrder, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, wethAddress } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const tokenBalancesInitial = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Close Position
            const maxInterest = await computeMaxInterest(position);
            const { request, signature } = await createClosePositionOrder({ position, interest: maxInterest });

            const tokenBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const balancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({ address: feeReceiver });
        
            const hash = await wasabiShortPool.write.closePosition([true, request, signature], { account: user1.account });

            const tokenBalancesAfter = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const balancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver);
            const userBalanceAfter = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({ address: feeReceiver });

            // Checks
            const events = await wasabiShortPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;

            const swap = (await mockSwap.getEvents.Swap())[0]!.args!;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(closePositionEvent.interestPaid!).to.equal(maxInterest, "If given interest value is 0, should use max interest");

            // Interest is paid in ETH, so the principal should be equal before and after the trade
            expect(tokenBalancesAfter.get(wasabiShortPool.address)).eq(tokenBalancesBefore.get(wasabiShortPool.address) + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
            expect(tokenBalancesInitial.get(wasabiShortPool.address) + closePositionEvent.interestPaid!).eq(tokenBalancesAfter.get(wasabiShortPool.address), "Original amount + interest wasn' repayed");

            expect(balancesAfter.get(wasabiShortPool.address)).to.equal(0);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(0, "Total return should be 0 on no price change");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(userBalanceAfter - userBalanceBefore).to.equal(closePositionEvent.payout! - gasUsed);

            // Check fees have been paid
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        it("Custom interest", async function () {
            const { sendDefaultOpenPositionRequest, createClosePositionOrder, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, wethAddress } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const tokenBalancesInitial = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Close Position
            const maxInterest = await computeMaxInterest(position);
            const interest = maxInterest / 2n;
            const { request, signature } = await createClosePositionOrder({ position, interest });

            const tokenBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const balancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({ address: feeReceiver });
        
            const hash = await wasabiShortPool.write.closePosition([true, request, signature], { account: user1.account });

            const tokenBalancesAfter = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const balancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver);
            const userBalanceAfter = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({ address: feeReceiver });

            // Checks
            const events = await wasabiShortPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;

            const swap = (await mockSwap.getEvents.Swap())[0]!.args!;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(closePositionEvent.interestPaid!).to.equal(interest, "Not payed custom interest");

            // Interest is paid in ETH, so the principal should be equal before and after the trade
            expect(tokenBalancesAfter.get(wasabiShortPool.address)).eq(tokenBalancesBefore.get(wasabiShortPool.address) + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
            expect(tokenBalancesInitial.get(wasabiShortPool.address) + closePositionEvent.interestPaid!).eq(tokenBalancesAfter.get(wasabiShortPool.address), "Original amount + interest wasn' repayed");

            expect(balancesAfter.get(wasabiShortPool.address)).to.equal(0);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(0, "Total return should be 0 on no price change");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(userBalanceAfter - userBalanceBefore).to.equal(closePositionEvent.payout! - gasUsed);

            // Check fees have been paid
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

    //     it("Price Increased", async function () {
    //         const { sendDefaultOpenPositionRequest, createClosePositionOrder, owner, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, initialPrice, contractName } = await loadFixture(deployLongPoolMockEnvironment);

    //         // Open Position
    //         const {position} = await sendDefaultOpenPositionRequest();

    //         await time.increase(86400n); // 1 day later
    //         await mockSwap.write.setPrice([uPPG.address, zeroAddress, initialPrice * 2n]); // Price doubled

    //         // Close Position
    //         const { request, signature } = await createClosePositionOrder({position});

    //         const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
    //         const poolBalanceBefore = await publicClient.getBalance({address: wasabiLongPool.address });
    //         const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

    //         const hash = await wasabiLongPool.write.closePosition([request, signature], { account: user1.account });

    //         const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
    //         const poolBalanceAfter = await publicClient.getBalance({address: wasabiLongPool.address });
    //         const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

    //         // Checks
    //         const events = await wasabiLongPool.getEvents.PositionClosed();
    //         expect(events).to.have.lengthOf(1);
    //         const closePositionEvent = events[0].args;
    //         const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

    //         expect(closePositionEvent.id).to.equal(position.id);
    //         expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
    //         expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

    //         expect(poolBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid! - position.feesToBePaid).to.equal(poolBalanceAfter);

    //         const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
    //         expect(totalReturn).to.equal(position.downPayment * 4n, "on 2x price increase, total return should be 4x down payment");

    //         // Check trader has been paid
    //         const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
    //         expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

    //         // Check fees have been paid
    //         expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);

    //         // console.log('gas used to close', formatEthValue(gasUsed, 8));
    //     });

    //     it("Price Decreased", async function () {
    //         const { sendDefaultOpenPositionRequest, createClosePositionOrder, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, initialPrice } = await loadFixture(deployLongPoolMockEnvironment);

    //         // Open Position
    //         const {position} = await sendDefaultOpenPositionRequest();

    //         await time.increase(86400n); // 1 day later
    //         await mockSwap.write.setPrice([uPPG.address, zeroAddress, initialPrice * 8n / 10n]); // Price fell 20%

    //         // Close Position
    //         const { request, signature } = await createClosePositionOrder({position});

    //         const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
    //         const poolBalanceBefore = await publicClient.getBalance({address: wasabiLongPool.address });
    //         const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

    //         const hash = await wasabiLongPool.write.closePosition([request, signature], { account: user1.account });

    //         const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
    //         const poolBalanceAfter = await publicClient.getBalance({address: wasabiLongPool.address });
    //         const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

    //         // Checks
    //         const events = await wasabiLongPool.getEvents.PositionClosed();
    //         expect(events).to.have.lengthOf(1);
    //         const closePositionEvent = events[0].args;
    //         const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

    //         expect(closePositionEvent.id).to.equal(position.id);
    //         expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
    //         expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

    //         expect(poolBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid! - position.feesToBePaid).to.equal(poolBalanceAfter);

    //         const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
    //         expect(totalReturn).to.equal(position.downPayment / -5n * 4n, "on 20% price decrease, total return should be -20% * leverage (4) * down payment");

    //         // Check trader has been paid
    //         const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
    //         expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

    //         // Check fees have been paid
    //         expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
    //     });
    });

    // describe("Liquidate Position", function () {
    //     it("liquidate", async function () {
    //         const { sendDefaultOpenPositionRequest, computeMaxInterest, owner, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, tradeFeeValue, feeDenominator, debtController, computeLiquidationPrice } = await loadFixture(deployLongPoolMockEnvironment);

    //         // Open Position
    //         const {position} = await sendDefaultOpenPositionRequest();

    //         await time.increase(86400n); // 1 day later

    //         // Liquidate Position
    //         const functionCallDataList = getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, zeroAddress, position.collateralAmount);

    //         const interest = await computeMaxInterest(position);
    //         const liquidationPrice = await computeLiquidationPrice(position);

    //         // If the liquidation price is not reached, should revert
    //         await mockSwap.write.setPrice([uPPG.address, zeroAddress, liquidationPrice + 1n]); 
    //         await expect(wasabiLongPool.write.liquidatePosition([interest, position, functionCallDataList], { account: owner.account }))
    //             .to.be.rejectedWith("LiquidationThresholdNotReached", "Cannot liquidate position if liquidation price is not reached");

    //         // Liquidate
    //         await mockSwap.write.setPrice([uPPG.address, zeroAddress, liquidationPrice]); 

    //         const balancesBefore = await takeBalanceSnapshot(publicClient, user1.account.address, wasabiLongPool.address, feeReceiver);

    //         const hash = await wasabiLongPool.write.liquidatePosition([interest, position, functionCallDataList], { account: owner.account });

    //         const balancesAfter = await takeBalanceSnapshot(publicClient, user1.account.address, wasabiLongPool.address, feeReceiver);

    //         // Checks
    //         const events = await wasabiLongPool.getEvents.PositionLiquidated();
    //         expect(events).to.have.lengthOf(1);
    //         const liquidatePositionEvent = events[0].args;
    //         const totalFeesPaid = liquidatePositionEvent.feeAmount! + position.feesToBePaid;

    //         expect(liquidatePositionEvent.id).to.equal(position.id);
    //         expect(liquidatePositionEvent.principalRepaid!).to.equal(position.principal);
    //         expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

    //         expect(balancesBefore.get(wasabiLongPool.address)! + liquidatePositionEvent.principalRepaid! + liquidatePositionEvent.interestPaid! - position.feesToBePaid).to.equal(balancesAfter.get(wasabiLongPool.address)!);

    //         // Check trader has been paid
    //         expect(balancesAfter.get(user1.account.address)! - balancesBefore.get(user1.account.address)!).to.equal(liquidatePositionEvent.payout!);

    //         // Check fees have been paid
    //         // Include gas since the liquidator is the fee receiver
    //         const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
    //         expect(balancesAfter.get(feeReceiver)! - balancesBefore.get(feeReceiver)! + gasUsed).to.equal(totalFeesPaid);
    //     });
    // });
})
