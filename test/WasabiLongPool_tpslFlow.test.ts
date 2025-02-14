import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { parseEther } from "viem";
import { expect } from "chai";
import { ClosePositionRequest, OrderType, PayoutType } from "./utils/PerpStructUtils";
import { deployLongPoolMockEnvironment } from "./fixtures";
import { getBalance } from "./utils/StateUtils";
import { getApproveAndSwapFunctionCallDataExact } from "./utils/SwapUtils";
import { signClosePositionRequest } from "./utils/SigningUtils";

describe("WasabiLongPool - TP/SL Flow Test", function () {
    describe("Take Profit", function () {
        it("Price increased to exact target", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, liquidator, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, initialPrice, wethAddress, vault } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            // Take Profit Order
            const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                orderType: OrderType.TP,
                traderSigner: user1,
                positionId: position.id,
                makerAmount: position.collateralAmount,
                takerAmount: (position.principal + position.downPayment) * 2n,
                expiration: await time.latest() + 172800,
                executionFee: parseEther("0.05"),
            });

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({position});

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceBefore = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition(
                [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
            );

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceAfter = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosedWithOrder();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!).to.equal(vaultBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount!;
            expect(totalReturn).to.equal(position.downPayment * 5n, "on 2x price increase, total return should be 4x down payment");

            // Check trader has been paid
            expect(traderBalanceAfter - traderBalanceBefore).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        it("Price increased above target", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, liquidator, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, initialPrice, wethAddress, vault } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            // Take Profit Order
            const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                orderType: OrderType.TP,
                traderSigner: user1,
                positionId: position.id,
                makerAmount: position.collateralAmount,
                takerAmount: (position.principal + position.downPayment) * 3n / 2n, // Expected 1.5x return
                expiration: await time.latest() + 172800,
                executionFee: parseEther("0.05"),
            });

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({position});

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceBefore = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition(
                [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
            );

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceAfter = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosedWithOrder();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!).to.equal(vaultBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount!;
            expect(totalReturn).to.equal(position.downPayment * 5n, "on 2x price increase, total return should be 4x down payment");

            // Check trader has been paid
            expect(traderBalanceAfter - traderBalanceBefore).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        it("Price increased to exact target - Partial Close", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, computeMaxInterest, liquidator, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, initialPrice, wethAddress, vault } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();
            const closeAmountDenominator = 2n;

            // Take Profit Order
            const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                orderType: OrderType.TP,
                traderSigner: user1,
                positionId: position.id,
                makerAmount: position.collateralAmount / closeAmountDenominator, // Partial close
                takerAmount: position.principal + position.downPayment,
                expiration: await time.latest() + 172800,
                executionFee: parseEther("0.05"),
            });

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

            // Close Position
            const interest = await computeMaxInterest(position) / closeAmountDenominator;
            const { request, signature } = await createSignedClosePositionRequest({position, interest, amount: position.collateralAmount / closeAmountDenominator});

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceBefore = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition(
                [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
            );

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceAfter = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionDecreasedWithOrder();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.closeFee! + closePositionEvent.pastFees!;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal / closeAmountDenominator);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(position.collateralAmount / closeAmountDenominator, "Pool should have half of the collateral left");

            expect(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!).to.equal(vaultBalanceAfter);

            const adjDownPayment = position.downPayment / closeAmountDenominator;
            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.closeFee! - adjDownPayment;
            expect(totalReturn).to.equal(adjDownPayment * 4n, "on 2x price increase, total return should be 4x the adjusted down payment");

            // Check trader has been paid
            expect(traderBalanceAfter - traderBalanceBefore).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        describe("Validations", function () {

            it("PriceTargetNotReached", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, wasabiLongPool, user1, uPPG, mockSwap, initialPrice, wethAddress, liquidator } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount,
                    takerAmount: (position.principal + position.downPayment) * 3n, // Expected 3x return
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiLongPool.write.closePosition(
                    [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
                )).to.be.rejectedWith("PriceTargetNotReached");
            });

            it("OrderExpired - Order", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, wasabiLongPool, mockSwap, user1, uPPG, initialPrice, wethAddress, liquidator } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount,
                    takerAmount: (position.principal + position.downPayment) * 2n,
                    expiration: await time.latest() + 86399,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiLongPool.write.closePosition(
                    [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
                )).to.be.rejectedWith("OrderExpired");
            });

            it("OrderExpired - Request", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, wasabiLongPool, mockSwap, user1, uPPG, initialPrice, wethAddress, liquidator } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount,
                    takerAmount: (position.principal + position.downPayment) * 2n,
                    expiration: await time.latest() + 86400,
                    executionFee: parseEther("0.05"),
                });

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await time.increase(86400); // 1 day later - skip ahead after creating request
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

                await expect(wasabiLongPool.write.closePosition(
                    [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
                )).to.be.rejectedWith("OrderExpired");
            });

            it("InvalidOrder - Position ID", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, wasabiLongPool, user1, uPPG, mockSwap, initialPrice, wethAddress, liquidator } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order - Invalid Position ID
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user1,
                    positionId: position.id + 1n, // Invalid position id
                    makerAmount: position.collateralAmount,
                    takerAmount: (position.principal + position.downPayment) * 2n,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiLongPool.write.closePosition(
                    [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
                )).to.be.rejectedWith("InvalidOrder");
            });

            it("InvalidOrder - Order Type", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, wasabiLongPool, user1, liquidator } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order - Invalid Order Type
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.INVALID, // Invalid order type
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount,
                    takerAmount: (position.principal + position.downPayment) * 2n,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiLongPool.write.closePosition(
                    [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
                )).to.be.rejectedWith("InvalidOrder");
            });

            it("TooMuchCollateralSpent", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, wasabiLongPool, user1, uPPG, mockSwap, initialPrice, wethAddress, liquidator } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount + 1n,
                    takerAmount: (position.principal + position.downPayment) * 2n, // Expected 2x return
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiLongPool.write.closePosition(
                    [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
                )).to.be.rejectedWith("TooMuchCollateralSpent");
            });

            it("InvalidSignature - Order", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, wasabiLongPool, user2, uPPG, mockSwap, initialPrice, wethAddress, liquidator } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user2, // Wrong signer
                    positionId: position.id,
                    makerAmount: position.collateralAmount,
                    takerAmount: (position.principal + position.downPayment) * 2n, // Expected 2x return
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiLongPool.write.closePosition(
                    [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
                )).to.be.rejectedWith("InvalidSignature");
            });

            it("InvalidSignature - Request", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, wasabiLongPool, user1, uPPG, mockSwap, initialPrice, wethAddress, liquidator } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount,
                    takerAmount: (position.principal + position.downPayment) * 2n, // Expected 2x return
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

                // Try to Close Position
                const { request } = await createSignedClosePositionRequest({position});

                await expect(wasabiLongPool.write.closePosition(
                    [PayoutType.UNWRAPPED, request, orderSignature, order, orderSignature], {account: liquidator.account} // Wrong signature
                )).to.be.rejectedWith("InvalidSignature");
            });

            it("InvalidSignature - Invalid Signer", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, wasabiLongPool, user1, user2, uPPG, mockSwap, initialPrice, wethAddress, liquidator } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Take Profit Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.TP,
                    traderSigner: user2,
                    positionId: position.id,
                    makerAmount: position.collateralAmount,
                    takerAmount: (position.principal + position.downPayment) * 3n / 2n, // Expected 1.5x return
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

                // Try to Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiLongPool.write.closePosition(
                    [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account} // Wrong signer
                )).to.be.rejectedWith("InvalidSignature");
            });
        });
    });

    describe("Stop Loss", function () {
        it("Price decreased to exact target", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, initialPrice, wethAddress, liquidator, vault } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            // Stop Loss Order
            const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                orderType: OrderType.SL,
                traderSigner: user1,
                positionId: position.id,
                makerAmount: position.collateralAmount,
                takerAmount: (position.principal + position.downPayment) * 8n / 10n,
                expiration: await time.latest() + 172800,
                executionFee: parseEther("0.05"),
            });

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 8n / 10n]); // Price fell 20%

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({position});

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceBefore = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition(
                [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
            );

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceAfter = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosedWithOrder();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!).to.equal(vaultBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(position.downPayment / -5n * 4n, "on 20% price decrease, total return should be -20% * leverage (4) * down payment");

            // Check trader has been paid
            expect(traderBalanceAfter - traderBalanceBefore).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        it("Price decreased below target", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, initialPrice, wethAddress, liquidator, vault } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            // Stop Loss Order
            const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                orderType: OrderType.SL,
                traderSigner: user1,
                positionId: position.id,
                makerAmount: position.collateralAmount,
                takerAmount: (position.principal + position.downPayment) * 9n / 10n,
                expiration: await time.latest() + 172800,
                executionFee: parseEther("0.05"),
            });

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 8n / 10n]); // Price fell 20%

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({position});

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceBefore = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition(
                [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
            );

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceAfter = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosedWithOrder();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!).to.equal(vaultBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(position.downPayment / -5n * 4n, "on 20% price decrease, total return should be -20% * leverage (4) * down payment");

            // Check trader has been paid
            expect(traderBalanceAfter - traderBalanceBefore).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        it("Price decreased to exact target - Partial Close", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, computeMaxInterest, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, initialPrice, wethAddress, liquidator, vault } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();
            const closeAmountDenominator = 2n;

            // Stop Loss Order
            const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                orderType: OrderType.SL,
                traderSigner: user1,
                positionId: position.id,
                makerAmount: position.collateralAmount / closeAmountDenominator, // Partial close
                takerAmount: (position.principal + position.downPayment) * 8n / 10n / closeAmountDenominator,
                expiration: await time.latest() + 172800,
                executionFee: parseEther("0.05"),
            });

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 8n / 10n]); // Price fell 20%

            // Close Position
            const interest = await computeMaxInterest(position) / closeAmountDenominator;
            const { request, signature } = await createSignedClosePositionRequest({position, interest, amount: position.collateralAmount / closeAmountDenominator});

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceBefore = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition(
                [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
            );

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const vaultBalanceAfter = await getBalance(publicClient, wethAddress, vault.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionDecreasedWithOrder();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.closeFee! + closePositionEvent.pastFees!;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal / closeAmountDenominator);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(position.collateralAmount / closeAmountDenominator, "Pool should have half of the collateral left");

            expect(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!).to.equal(vaultBalanceAfter);

            const adjDownPayment = position.downPayment / closeAmountDenominator;
            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.closeFee! - adjDownPayment;
            expect(totalReturn).to.equal(adjDownPayment / -5n * 4n, "on 20% price decrease, total return should be -20% * leverage (4) * adjusted down payment");

            // Check trader has been paid
            expect(traderBalanceAfter - traderBalanceBefore).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        describe("Validations", function () {
            it("PriceTargetNotReached", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, createSignedClosePositionOrder, wasabiLongPool, user1, uPPG, mockSwap, initialPrice, wethAddress, liquidator } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Stop Loss Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.SL,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount,
                    takerAmount: (position.principal + position.downPayment) * 8n / 10n,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 9n / 10n]); // Price fell 10%

                // Close Position
                const { request, signature } = await createSignedClosePositionRequest({position});

                await expect(wasabiLongPool.write.closePosition(
                    [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
                )).to.be.rejectedWith("PriceTargetNotReached");
            });

            it("InsufficientPrincipalRepaid - Bad debt from bad swap function call", async function () {
                const { sendDefaultOpenPositionRequest, createSignedClosePositionOrder, orderSigner, contractName, wasabiLongPool, user1, uPPG, mockSwap, initialPrice, wethAddress, liquidator } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                // Stop Loss Order
                const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                    orderType: OrderType.SL,
                    traderSigner: user1,
                    positionId: position.id,
                    makerAmount: position.collateralAmount,
                    takerAmount: (position.principal + position.downPayment) * 8n / 10n,
                    expiration: await time.latest() + 172800,
                    executionFee: parseEther("0.05"),
                });

                await time.increase(86400n); // 1 day later
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 8n / 10n]); // Price fell 20%

                // Craft a ClosePositionRequest with a malicious swap function call using MockSwap.swapExact
                const request: ClosePositionRequest = {
                    expiration: BigInt(await time.latest() + 172800),
                    interest: 0n,
                    amount: 0n,
                    position,
                    functionCallDataList: getApproveAndSwapFunctionCallDataExact(mockSwap.address, position.collateralCurrency, position.currency, position.collateralAmount, 1n), // bad amountOut
                };
                const signature = await signClosePositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

                await expect(wasabiLongPool.write.closePosition(
                    [PayoutType.UNWRAPPED, request, signature, order, orderSignature], {account: liquidator.account}
                )).to.be.rejectedWith("InsufficientPrincipalRepaid");
            });
        });
    });
});