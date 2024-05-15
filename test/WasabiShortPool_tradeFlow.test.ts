import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { getAddress, parseEther, maxUint256, zeroAddress } from "viem";
import { getValueWithoutFee } from "./utils/PerpStructUtils";
import { getApproveAndSwapExactlyOutFunctionCallData, getApproveAndSwapFunctionCallData } from "./utils/SwapUtils";
import { deployLongPoolMockEnvironment, deployShortPoolMockEnvironment, deployWasabiLongPool, deployWasabiShortPool } from "./fixtures";
import { getBalance, takeBalanceSnapshot } from "./utils/StateUtils";

describe("WasabiShortPool - Trade Flow Test", function () {

    describe("Open Position", function () {
        it("Open Position", async function () {
            const { wasabiShortPool, tradeFeeValue, publicClient, user1, openPositionRequest, downPayment, signature, wethAddress, mockSwap } = await loadFixture(deployShortPoolMockEnvironment);

            const hash = await wasabiShortPool.write.openPosition([openPositionRequest, signature], { account: user1.account });

            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed);
            console.log('gas used to open', gasUsed);

            const events = await wasabiShortPool.getEvents.PositionOpened();
            expect(events).to.have.lengthOf(1);
            const event = events[0].args;
            expect(event.positionId).to.equal(openPositionRequest.id);
            expect(event.downPayment).to.equal(downPayment);
            expect(event.collateralAmount! + event.feesToBePaid!).to.equal(await getBalance(publicClient, wethAddress, wasabiShortPool.address));
        });
    });

    describe("Close Position", function () {
        it("Price Not Changed", async function () {
            const { sendDefaultOpenPositionRequest, createClosePositionOrder, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, wethAddress } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const tokenBalancesInitial = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n * 3n); // 1 day later

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

    describe("Liquidate Position", function () {
        it("liquidate", async function () {
            const { owner, sendDefaultOpenPositionRequest, liquidator, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, liquidationFeeReceiver, wethAddress, computeLiquidationPrice } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const tokenBalancesInitial = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            const maxInterest = await computeMaxInterest(position);
            const functionCallDataList = getApproveAndSwapExactlyOutFunctionCallData(
                mockSwap.address,
                position.collateralCurrency,
                position.currency,
                position.collateralAmount,
                position.principal + maxInterest);

            await expect(wasabiShortPool.write.liquidatePosition([true, maxInterest, position, functionCallDataList], { account: liquidator.account }))
                .to.be.rejectedWith("LiquidationThresholdNotReached", "Cannot liquidate position if liquidation price is not reached");

            // Liquidate Position
            const liquidationPrice = await computeLiquidationPrice(position);
            await mockSwap.write.setPrice([uPPG.address, wethAddress, liquidationPrice + 1n]); 

            const tokenBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const balancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver, liquidationFeeReceiver);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({ address: feeReceiver });
            const liquidationFeeReceiverBalanceBefore = await publicClient.getBalance({address: liquidationFeeReceiver });    

            const hash = await wasabiShortPool.write.liquidatePosition([true, maxInterest, position, functionCallDataList], { account: liquidator.account });

            const tokenBalancesAfter = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const balancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver, liquidationFeeReceiver);
            const userBalanceAfter = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({ address: feeReceiver });
            const liquidationFeeReceiverBalanceAfter = await publicClient.getBalance({address: liquidationFeeReceiver });

            // Checks
            const events = await wasabiShortPool.getEvents.PositionLiquidated();
            expect(events).to.have.lengthOf(1);
            const liquidateEvent = events[0].args;

            const swap = (await mockSwap.getEvents.Swap())[0]!.args!;

            expect(liquidateEvent.id).to.equal(position.id);
            expect(liquidateEvent.principalRepaid!).to.equal(position.principal);
            expect(liquidateEvent.interestPaid!).to.equal(maxInterest, "If given interest value is 0, should use max interest");

            // Interest is paid in ETH, so the principal should be equal before and after the trade
            expect(tokenBalancesAfter.get(wasabiShortPool.address)).eq(tokenBalancesBefore.get(wasabiShortPool.address) + liquidateEvent.principalRepaid! + liquidateEvent.interestPaid!, "Invalid repay amount");
            expect(tokenBalancesInitial.get(wasabiShortPool.address) + liquidateEvent.interestPaid!).eq(tokenBalancesAfter.get(wasabiShortPool.address), "Original amount + interest wasn' repayed");

            expect(balancesAfter.get(wasabiShortPool.address)).to.equal(0);

            // const totalReturn = liquidateEvent.payout! + liquidateEvent.interestPaid! + liquidateEvent.feeAmount! - position.downPayment;
            // expect(totalReturn).to.equal(0, "Total return should be 0 on no price change");

            expect(userBalanceAfter - userBalanceBefore).to.equal(liquidateEvent.payout!);

            // Check fees have been paid
            const totalFeesPaid = liquidateEvent.feeAmount! + position.feesToBePaid;
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);

            if (liquidateEvent.payout! < position.downPayment * 3n / 100n) {
                expect(userBalanceAfter - userBalanceBefore).to.equal(0n);
            } else {
                expect(userBalanceAfter - userBalanceBefore).to.equal(liquidateEvent.payout!);
            }

            // Check liquidation fee receiver balance
            const liquidationFeeExpected = position.downPayment * 3n / 100n;
            expect(liquidationFeeReceiverBalanceAfter - liquidationFeeReceiverBalanceBefore).to.equal(liquidationFeeExpected);
        });
    });


    describe("Claim Position", function () {
        it("Claim successfully", async function () {
            const { owner, sendDefaultOpenPositionRequest, createClosePositionOrder, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, wethAddress, computeLiquidationPrice } = await loadFixture(deployShortPoolMockEnvironment);

            await uPPG.write.mint([user1.account.address, parseEther("50")]);
            const initialUserUPPGBalance = await uPPG.read.balanceOf([user1.account.address]);

            const poolBalanceInitial = await getBalance(publicClient, uPPG.address, wasabiShortPool.address);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            const poolBalanceBefore = await getBalance(publicClient, uPPG.address, wasabiShortPool.address);

            await time.increase(86400n); // 1 day later

            await uPPG.write.approve([wasabiShortPool.address, maxUint256], { account: user1.account });

            const interest = await computeMaxInterest(position);
            const amountToPay = position.principal + interest;

            const traderBalanceBefore = await getBalance(publicClient, zeroAddress, user1.account.address);

            const hash = await wasabiShortPool.write.claimPosition([position], { account: user1.account });

            const traderBalanceAfter = await getBalance(publicClient, zeroAddress, user1.account.address);

            const poolBalanceAfter = await getBalance(publicClient, uPPG.address, wasabiShortPool.address);

            expect(poolBalanceAfter - poolBalanceBefore).to.equal(position.principal + interest);
            expect(await getBalance(publicClient, zeroAddress, wasabiShortPool.address)).to.equal(0n, "Pool should not have any collateral left");
            expect(poolBalanceAfter - poolBalanceInitial).to.equal(interest, 'The position should have increased the pool balance by the interest amount');

            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore).to.equal(position.collateralAmount - position.feesToBePaid - gasUsed, "Trader should have received the collateral amount minus fees");

            const events = await wasabiShortPool.getEvents.PositionClaimed();
            expect(events).to.have.lengthOf(1);
            const claimPositionEvent = events[0].args!;
            expect(claimPositionEvent.id).to.equal(position.id);
            expect(claimPositionEvent.principalRepaid!).to.equal(position.principal);
            expect(claimPositionEvent.interestPaid!).to.equal(interest);
            expect(claimPositionEvent.feeAmount!).to.equal(position.feesToBePaid);
        });
    });
})
