import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import {encodeFunctionData, zeroAddress, parseEther} from "viem";
import { expect } from "chai";
import { Position, OrderType, getEventPosition, getValueWithoutFee, ClosePositionRequest } from "./utils/PerpStructUtils";
import { getApproveAndSwapFunctionCallData, getApproveAndSwapFunctionCallDataExact } from "./utils/SwapUtils";
import { deployShortPoolMockEnvironment } from "./fixtures";
import { getBalance, takeBalanceSnapshot } from "./utils/StateUtils";
import { signClosePositionRequest, signOpenPositionRequest } from "./utils/SigningUtils";

describe("WasabiShortPool - TP/SL Flow Test", function () {
    describe("Take Profit", function () {
        it("Price decreased to exact target", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const tokenBalancesInitial = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const {position} = await sendDefaultOpenPositionRequest();

            // Take Profit Order
            const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                orderType: OrderType.TP,
                traderSigner: user1,
                positionId: position.id,
                makerAmount: position.collateralAmount / 2n,
                takerAmount: position.principal + position.downPayment,
                expiration: await time.latest() + 172800,
                executionFee: parseEther("0.05"),
            });

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 2n]); // Price halved

            // Close Position
            const maxInterest = await computeMaxInterest(position);
            const { request, signature } = await createSignedClosePositionRequest({ position, interest: maxInterest });
            
            const tokenBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({ address: feeReceiver });
        
            const hash = await wasabiShortPool.write.closePosition(
                [true, request, signature, order, orderSignature]
            );

            const tokenBalancesAfter = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const balancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver);
            const userBalanceAfter = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({ address: feeReceiver });

            // Checks
            const events = await wasabiShortPool.getEvents.PositionClosedWithOrder();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(closePositionEvent.interestPaid!).to.equal(maxInterest, "If given interest value is 0, should use max interest");

            // Interest is paid in uPPG, so the principal should be equal before and after the trade
            expect(tokenBalancesAfter.get(wasabiShortPool.address)).eq(tokenBalancesBefore.get(wasabiShortPool.address) + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
            expect(tokenBalancesInitial.get(wasabiShortPool.address) + closePositionEvent.interestPaid!).eq(tokenBalancesAfter.get(wasabiShortPool.address), "Original amount + interest wasn't repayed");

            expect(balancesAfter.get(wasabiShortPool.address)).to.equal(0, "Pool should not have any collateral left");

            const interestPaidInEth = closePositionEvent.interestPaid! / 2n;
            const totalReturn = closePositionEvent.payout! + closePositionEvent.feeAmount! - position.downPayment + interestPaidInEth;
            expect(totalReturn).to.equal(position.downPayment * 5n / 2n, "On 50% price decrease w/ 5x leverage, total return should be 2.5x down payment");

            // Check trader has been paid
            expect(userBalanceAfter - userBalanceBefore).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore + gasUsed).to.equal(totalFeesPaid);
        });
        it("Price decreased to below target", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const tokenBalancesInitial = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const {position} = await sendDefaultOpenPositionRequest();

            // Take Profit Order
            const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                orderType: OrderType.TP,
                traderSigner: user1,
                positionId: position.id,
                makerAmount: position.collateralAmount / 2n,
                takerAmount: position.principal + position.downPayment,
                expiration: await time.latest() + 172800,
                executionFee: parseEther("0.05"),
            });

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 4n]); // Price quartered

            // Close Position
            const maxInterest = await computeMaxInterest(position);
            const { request, signature } = await createSignedClosePositionRequest({ position, interest: maxInterest });
            
            const tokenBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({ address: feeReceiver });
        
            const hash = await wasabiShortPool.write.closePosition(
                [true, request, signature, order, orderSignature]
            );

            const tokenBalancesAfter = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const balancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver);
            const userBalanceAfter = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({ address: feeReceiver });

            // Checks
            const events = await wasabiShortPool.getEvents.PositionClosedWithOrder();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(closePositionEvent.interestPaid!).to.equal(maxInterest, "If given interest value is 0, should use max interest");

            // Interest is paid in uPPG, so the principal should be equal before and after the trade
            expect(tokenBalancesAfter.get(wasabiShortPool.address)).eq(tokenBalancesBefore.get(wasabiShortPool.address) + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
            expect(tokenBalancesInitial.get(wasabiShortPool.address) + closePositionEvent.interestPaid!).eq(tokenBalancesAfter.get(wasabiShortPool.address), "Original amount + interest wasn't repayed");

            expect(balancesAfter.get(wasabiShortPool.address)).to.equal(0, "Pool should not have any collateral left");

            const interestPaidInEth = closePositionEvent.interestPaid! / 4n;
            const totalReturn = closePositionEvent.payout! + closePositionEvent.feeAmount! - position.downPayment + interestPaidInEth;
            expect(totalReturn).to.equal(position.downPayment * 15n / 4n, "On 75% price decrease w/ 5x leverage, total return should be 3.75x down payment");

            // Check trader has been paid
            expect(userBalanceAfter - userBalanceBefore).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore + gasUsed).to.equal(totalFeesPaid);
        });

        describe("Validations", function () {
            it("PriceTargetNotReached", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, mockSwap, publicClient, wasabiShortPool, user1, uPPG, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const tokenBalancesInitial = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount / 4n,
                    takerAmount: position.principal + position.downPayment,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 2n]); // Price halved

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiShortPool.write.closePosition(
                    [true, request, signature, order, orderSignature]
                )).to.be.rejectedWith("PriceTargetNotReached");
            });

            it("OrderExpired - Order", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, mockSwap, publicClient, wasabiShortPool, user1, uPPG, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount / 2n,
                    takerAmount: position.principal + position.downPayment,
                    expiration: await time.latest() + 86399,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 2n]); // Price halved

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiShortPool.write.closePosition(
                    [true, request, signature, order, orderSignature]
                )).to.be.rejectedWith("OrderExpired");
            });

            it("OrderExpired - Request", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, mockSwap, publicClient, wasabiShortPool, user1, uPPG, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount / 2n,
                    takerAmount: position.principal + position.downPayment,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 2n]); // Price halved

                await expect(wasabiShortPool.write.closePosition(
                    [true, request, signature, order, orderSignature]
                )).to.be.rejectedWith("OrderExpired");
            });

            it("InvalidOrder - Position ID", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, mockSwap, publicClient, wasabiShortPool, user1, uPPG, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user1,
                    positionId: position.id + 1n, // Invalid Position ID
                    makerAmount: position.collateralAmount / 2n,
                    takerAmount: position.principal + position.downPayment,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 2n]); // Price halved

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiShortPool.write.closePosition(
                    [true, request, signature, order, orderSignature]
                )).to.be.rejectedWith("InvalidOrder");
            });

            it("InvalidOrder - OrderType", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, mockSwap, publicClient, wasabiShortPool, user1, uPPG, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.INVALID, // Invalid Order Type
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount / 2n,
                    takerAmount: position.principal + position.downPayment,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 2n]); // Price halved

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiShortPool.write.closePosition(
                    [true, request, signature, order, orderSignature]
                )).to.be.rejectedWith("InvalidOrder");
            });

            it("InvalidSignature - Order", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, mockSwap, publicClient, wasabiShortPool, user2, uPPG, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user2, // Wrong Signer
                    positionId: position.id,
                    makerAmount: position.collateralAmount / 2n,
                    takerAmount: position.principal + position.downPayment,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 2n]); // Price halved

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiShortPool.write.closePosition(
                    [true, request, signature, order, orderSignature]
                )).to.be.rejectedWith("InvalidSignature");
            });

            it("InvalidSignature - Request", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, mockSwap, publicClient, wasabiShortPool, user1, uPPG, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount / 2n,
                    takerAmount: position.principal + position.downPayment,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 2n]); // Price halved

                // Try to Close Position
                const { request } = await createSignedClosePositionRequest({position});

                await expect(wasabiShortPool.write.closePosition(
                    [true, request, orderSignature, order, orderSignature]
                )).to.be.rejectedWith("InvalidSignature");
            });
        });
    });

    describe("Stop Loss", function () {
        it("Price increased to exact target", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const tokenBalancesInitial = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const {position} = await sendDefaultOpenPositionRequest();

            // Stop Loss Order
            const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                orderType: OrderType.SL,
                traderSigner: user1,
                positionId: position.id,
                makerAmount: position.collateralAmount * 11n / 10n,
                takerAmount: position.principal + position.downPayment,
                expiration: await time.latest() + 172800,
                executionFee: parseEther("0.05"),
            });

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice * 11n / 10n]); // Price rose by 10%

            // Close Position
            const maxInterest = await computeMaxInterest(position);
            const { request, signature } = await createSignedClosePositionRequest({ position, interest: maxInterest });
            
            const tokenBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({ address: feeReceiver });
        
            const hash = await wasabiShortPool.write.closePosition(
                [true, request, signature, order, orderSignature]
            );

            const tokenBalancesAfter = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const balancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver);
            const userBalanceAfter = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({ address: feeReceiver });

            // Checks
            const events = await wasabiShortPool.getEvents.PositionClosedWithOrder();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(closePositionEvent.interestPaid!).to.equal(maxInterest, "If given interest value is 0, should use max interest");

            expect(tokenBalancesAfter.get(wasabiShortPool.address)).eq(tokenBalancesBefore.get(wasabiShortPool.address) + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
            expect(tokenBalancesInitial.get(wasabiShortPool.address) + closePositionEvent.interestPaid!).eq(tokenBalancesAfter.get(wasabiShortPool.address), "Original amount + interest wasn't repayed");

            expect(balancesAfter.get(wasabiShortPool.address)).to.equal(0, "Pool should not have any collateral left");

            const interestPaidInEth = closePositionEvent.interestPaid! * 11n / 10n;
            const totalReturn = closePositionEvent.payout! + closePositionEvent.feeAmount! - position.downPayment + interestPaidInEth;
            expect(totalReturn).to.be.approximately(position.downPayment / -2n, parseEther("0.001"), "On 10% price increase w/ 5x leverage, total return should be approximately -0.5x down payment");

            // Check trader has been paid
            expect(userBalanceAfter - userBalanceBefore).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore + gasUsed).to.equal(totalFeesPaid);
        });

        it("Price increased above target", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const tokenBalancesInitial = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const {position} = await sendDefaultOpenPositionRequest();

            // Stop Loss Order
            const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                orderType: OrderType.SL,
                traderSigner: user1,
                positionId: position.id,
                makerAmount: position.collateralAmount * 21n / 20n,
                takerAmount: position.principal + position.downPayment,
                expiration: await time.latest() + 172800,
                executionFee: parseEther("0.05"),
            });

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice * 11n / 10n]); // Price rose by 10%

            // Close Position
            const maxInterest = await computeMaxInterest(position);
            const { request, signature } = await createSignedClosePositionRequest({ position, interest: maxInterest });
            
            const tokenBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({ address: feeReceiver });
        
            const hash = await wasabiShortPool.write.closePosition(
                [true, request, signature, order, orderSignature]
            );

            const tokenBalancesAfter = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiShortPool.address);
            const balancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver);
            const userBalanceAfter = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({ address: feeReceiver });

            // Checks
            const events = await wasabiShortPool.getEvents.PositionClosedWithOrder();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(closePositionEvent.interestPaid!).to.equal(maxInterest, "If given interest value is 0, should use max interest");

            expect(tokenBalancesAfter.get(wasabiShortPool.address)).eq(tokenBalancesBefore.get(wasabiShortPool.address) + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
            expect(tokenBalancesInitial.get(wasabiShortPool.address) + closePositionEvent.interestPaid!).eq(tokenBalancesAfter.get(wasabiShortPool.address), "Original amount + interest wasn't repayed");

            expect(balancesAfter.get(wasabiShortPool.address)).to.equal(0, "Pool should not have any collateral left");

            const interestPaidInEth = closePositionEvent.interestPaid! * 11n / 10n;
            const totalReturn = closePositionEvent.payout! + closePositionEvent.feeAmount! - position.downPayment + interestPaidInEth;
            expect(totalReturn).to.be.approximately(position.downPayment / -2n, parseEther("0.001"), "On 10% price increase w/ 5x leverage, total return should be approximately -0.5x down payment");

            // Check trader has been paid
            expect(userBalanceAfter - userBalanceBefore).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore + gasUsed).to.equal(totalFeesPaid);
        });

        describe("Validations", function () {
            it("PriceTargetNotReached", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, mockSwap, wasabiShortPool, user1, uPPG, wethAddress, initialPPGPrice } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Stop Loss Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.SL,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount * 11n / 10n,
                    takerAmount: position.principal + position.downPayment,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice * 21n / 20n]); // Price increased by 5%

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiShortPool.write.closePosition(
                    [true, request, signature, order, orderSignature]
                )).to.be.rejectedWith("PriceTargetNotReached");
            });

            it("InsufficientPrincipalRepaid - Bad debt from bad swap function call", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionOrder, orderSigner, contractName, wasabiShortPool, user1, uPPG, mockSwap, initialPPGPrice, wethAddress } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Stop Loss Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.SL,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount * 11n / 10n,
                    takerAmount: position.principal + position.downPayment,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice * 11n / 10n]); // Price rose by 10%

                // Craft a ClosePositionRequest with a malicious swap function call using MockSwap.swapExact
                const request: ClosePositionRequest = {
                    expiration: BigInt(await time.latest() + 172800),
                    interest: 0n,
                    position,
                    functionCallDataList: getApproveAndSwapFunctionCallDataExact(mockSwap.address, position.collateralCurrency, position.currency, position.collateralAmount, 1n), // bad amountOut
                };
                const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.closePosition(
                    [true, request, signature, order, orderSignature]
                )).to.be.rejectedWith("InsufficientPrincipalRepaid");
            });
        });
    });
});