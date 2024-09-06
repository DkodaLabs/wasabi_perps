import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import {encodeFunctionData, zeroAddress} from "viem";
import { expect } from "chai";
import { Position, formatEthValue, getEventPosition, PayoutType } from "./utils/PerpStructUtils";
import { getApproveAndSwapFunctionCallData } from "./utils/SwapUtils";
import { deployLongPoolMockEnvironment } from "./fixtures";
import { getBalance, takeBalanceSnapshot } from "./utils/StateUtils";
import { signOpenPositionRequest } from "./utils/SigningUtils";


describe("WasabiLongPool - Trade Flow Test", function () {
    describe("Open Position", function () {
        it("Open Position", async function () {
            const { wasabiLongPool, tradeFeeValue, uPPG, user1, openPositionRequest, totalAmountIn, signature, publicClient,  } = await loadFixture(deployLongPoolMockEnvironment);

            const hash = await wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account });

            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed);
            console.log('gas used to open', gasUsed);

            const events = await wasabiLongPool.getEvents.PositionOpened();
            expect(events).to.have.lengthOf(1);
            const eventData = events[0].args;
            expect(eventData.positionId).to.equal(openPositionRequest.id);
            expect(eventData.downPayment).to.equal(totalAmountIn - eventData.feesToBePaid!);
            expect(eventData.principal).to.equal(openPositionRequest.principal);
            expect(eventData.collateralAmount).to.equal(await uPPG.read.balanceOf([wasabiLongPool.address]));
            expect(eventData.collateralAmount).to.greaterThanOrEqual(openPositionRequest.minTargetAmount);
        });
    });

    describe("Close Position", function () {
        it("Price Not Changed", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, computeMaxInterest, publicClient, wasabiLongPool, user1, uPPG, feeReceiver, wethAddress } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later
            // await time.setNextBlockTimestamp(await time.latest() + 100);

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({ position, interest: 0n });

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceBefore = await getBalance(publicClient, wethAddress, wasabiLongPool.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const maxInterest = await computeMaxInterest(position);
            
            const hash = await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceAfter = await getBalance(publicClient, wethAddress, wasabiLongPool.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(closePositionEvent.interestPaid!).to.equal(maxInterest, "If given interest value is 0, should use max interest");
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(poolBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid! - position.feesToBePaid).to.equal(poolBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(0, "Total return should be 0 on no price change");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

            const gasAmount = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed);
            console.log('gas used to close', gasAmount);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        it("Use Custom Interest", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, computeMaxInterest, publicClient, wasabiLongPool, user1, uPPG, feeReceiver, wethAddress } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            const interest = (await computeMaxInterest(position)) / 2n;
            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({
                position,
                interest
            });

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceBefore = await getBalance(publicClient, wethAddress, wasabiLongPool.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceAfter = await getBalance(publicClient, wethAddress, wasabiLongPool.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(closePositionEvent.interestPaid!).to.equal(interest);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(poolBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid! - position.feesToBePaid).to.equal(poolBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(0, "Total return should be 0 on no price change");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        it("Price Increased", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, owner, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, initialPrice, wethAddress } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({position});

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceBefore = await getBalance(publicClient, wethAddress, wasabiLongPool.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceAfter = await getBalance(publicClient, wethAddress, wasabiLongPool.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(poolBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid! - position.feesToBePaid).to.equal(poolBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount!;
            expect(totalReturn).to.equal(position.downPayment * 5n, "on 2x price increase, total return should be 4x down payment");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);

            console.log('gas used to close', formatEthValue(gasUsed, 8));
        });

        it("Price Increased - Deposit Into Vault", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, owner, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, initialPrice, wethAddress, vault } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 2n]); // Price doubled

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({position});

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceBefore = await getBalance(publicClient, wethAddress, wasabiLongPool.address);
            const feeReceiverBalanceBefore = await getBalance(publicClient, wethAddress, feeReceiver);
            const vaultSharesBefore = await vault.read.balanceOf([user1.account.address]);

            const hash = await wasabiLongPool.write.closePosition([PayoutType.VAULT_DEPOSIT, request, signature], { account: user1.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceAfter = await getBalance(publicClient, wethAddress, wasabiLongPool.address);
            const feeReceiverBalanceAfter = await getBalance(publicClient, wethAddress, feeReceiver);
            const vaultSharesAfter = await vault.read.balanceOf([user1.account.address]);

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;
            const expectedNewVaultShares = await vault.read.convertToShares([closePositionEvent.payout!]);

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount!;
            expect(totalReturn).to.equal(position.downPayment * 5n, "on 2x price increase, total return should be 4x down payment");

            // Check trader has received vault shares instead of payout
            expect(vaultSharesAfter).to.equal(vaultSharesBefore + expectedNewVaultShares, "Trader should have received vault shares instead of payout");
            expect(poolBalanceAfter).to.equal(poolBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid! + closePositionEvent.payout! - position.feesToBePaid, "Pool should have received principal + interest + payout - fees");
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(0n);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid, "Fees should have been paid to fee receiver");

            console.log('gas used to close', formatEthValue(gasUsed, 8));
        });

        it("Price Decreased", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, initialPrice, wethAddress } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice * 8n / 10n]); // Price fell 20%

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({position});

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceBefore = await getBalance(publicClient, wethAddress, wasabiLongPool.address);
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceAfter = await getBalance(publicClient, wethAddress, wasabiLongPool.address);
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(poolBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid! - position.feesToBePaid).to.equal(poolBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(position.downPayment / -5n * 4n, "on 20% price decrease, total return should be -20% * leverage (4) * down payment");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });
    });

    describe("Liquidate Position", function () {
        it("liquidate", async function () {
            const { sendDefaultOpenPositionRequest, computeMaxInterest, owner, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, liquidationFeeReceiver, wethAddress, liquidator, computeLiquidationPrice } = await loadFixture(deployLongPoolMockEnvironment);
            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Liquidate Position
            const functionCallDataList = getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, position.collateralAmount);

            const interest = await computeMaxInterest(position);
            const liquidationPrice = await computeLiquidationPrice(position);

            // If the liquidation price is not reached, should revert
            await mockSwap.write.setPrice([uPPG.address, wethAddress, liquidationPrice + 1n]); 
            await expect(wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: liquidator.account }))
                .to.be.rejectedWith("LiquidationThresholdNotReached", "Cannot liquidate position if liquidation price is not reached");

            // Liquidate
            await mockSwap.write.setPrice([uPPG.address, wethAddress, liquidationPrice]); 

            const balancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, wasabiLongPool.address, user1.account.address, feeReceiver, liquidationFeeReceiver);
            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });
            const liquidationFeeReceiverBalanceBefore = await publicClient.getBalance({address: liquidationFeeReceiver });            

            const hash = await wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: liquidator.account });

            const balancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, wasabiLongPool.address, user1.account.address, feeReceiver);
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
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(balancesBefore.get(wasabiLongPool.address) + liquidatePositionEvent.principalRepaid! + liquidatePositionEvent.interestPaid! - position.feesToBePaid).to.equal(balancesAfter.get(wasabiLongPool.address)!);

            // Check trader has been paid
            expect(traderBalanceAfter - traderBalanceBefore).to.equal(liquidatePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);

            // Check liquidation fee receiver balance
            const liquidationFeeExpected = position.downPayment * 5n / 100n;
            expect(liquidationFeeReceiverBalanceAfter - liquidationFeeReceiverBalanceBefore).to.equal(liquidationFeeExpected);
        });

        it("liqudateWithNoPayout", async function () {
            const { sendDefaultOpenPositionRequest, computeMaxInterest, owner, publicClient, wasabiLongPool, user1, uPPG, mockSwap, feeReceiver, liquidationFeeReceiver, wethAddress, liquidator, computeLiquidationPrice } = await loadFixture(deployLongPoolMockEnvironment);
            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();
    
            await time.increase(86400n); // 1 day later
    
            // Liquidate Position
            const functionCallDataList = getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, position.collateralAmount);
    
            const interest = await computeMaxInterest(position);
            const liquidationPrice = await computeLiquidationPrice(position);
    
            // If the liquidation price is not reached, should revert
            await mockSwap.write.setPrice([uPPG.address, wethAddress, liquidationPrice + 1n]); 
            await expect(wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: liquidator.account }))
                .to.be.rejectedWith("LiquidationThresholdNotReached", "Cannot liquidate position if liquidation price is not reached");
    
            await mockSwap.write.setPrice([uPPG.address, wethAddress, liquidationPrice / 2n]); 
    
            await wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: liquidator.account });
            // Checks for no payout
            const events = await wasabiLongPool.getEvents.PositionLiquidated();
            expect(events).to.have.lengthOf(1);
            const liquidatePositionEvent = events[0].args;
            expect(liquidatePositionEvent.payout!).to.equal(0n);
        });

        it("multi liquidations", async function () {
            const { sendDefaultOpenPositionRequest, computeMaxInterest, orderSigner, owner, liquidator, publicClient, wasabiLongPool, user1, user2, uPPG, mockSwap, feeReceiver, wethAddress, openPositionRequest, contractName, computeLiquidationPrice } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            // Open another position
            const request2 = { ...openPositionRequest, id: openPositionRequest.id + 1n };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request2);
            await wasabiLongPool.write.openPosition([request2, signature], { account: user2.account });
            const event = (await wasabiLongPool.getEvents.PositionOpened())[0];
            const position2: Position = await getEventPosition(event);

            expect(position2.id).to.not.equal(position.id);
            const positions = [position, position2];

            await time.increase(86400n); // 1 day later

            // Liquidate Position
            const functionCallDataList = getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, position.collateralAmount);

            const interest = await computeMaxInterest(position);
            const liquidationPrice = await computeLiquidationPrice(position);

            const functionCallDataList2 = getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, position2.collateralAmount);

            const interest2 = await computeMaxInterest(position);
            const liquidationPrice2 = await computeLiquidationPrice(position);

            expect(liquidationPrice).to.equal(liquidationPrice2);

            // If the liquidation price is not reached, should revert
            await mockSwap.write.setPrice([uPPG.address, wethAddress, liquidationPrice + 1n]);

            const liq1 = encodeFunctionData({
                abi: wasabiLongPool.abi,
                functionName: "liquidatePosition",
                args: [true, interest, position, functionCallDataList]
            });

            const liq2 = encodeFunctionData({
                abi: wasabiLongPool.abi,
                functionName: "liquidatePosition",
                args: [true, interest2, position2, functionCallDataList2]
            });

            await expect(wasabiLongPool.write.multicall([[liq1, liq2]], { account: liquidator.account }))
                .to.be.rejectedWith("LiquidationThresholdNotReached", "Cannot liquidate position if liquidation price is not reached");

            // Liquidate
            await mockSwap.write.setPrice([uPPG.address, wethAddress, liquidationPrice]); 

            const balancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, wasabiLongPool.address);
            const ethBalancesBefore = await takeBalanceSnapshot(publicClient, zeroAddress, user1.account.address, user2.account.address, feeReceiver);
            
            const hash = await wasabiLongPool.write.multicall([[liq1, liq2]], { account: liquidator.account });

            const balancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, wasabiLongPool.address);
            const ethBalancesAfter = await takeBalanceSnapshot(publicClient, zeroAddress, user1.account.address, user2.account.address, feeReceiver);

            // Checks
            const events = await wasabiLongPool.getEvents.PositionLiquidated();
            expect(events).to.have.lengthOf(2);

            let totalFeesPaid = 0n
            let feesToBePaid = 0n;
            let totalInterestPaid = 0n;
            let totalPrincipalRepaid = 0n;
            for (const event of events) {
                const liquidatePositionEvent = event.args;
                const position = positions.find(p => p.id === liquidatePositionEvent.id)!;
                const trader = position.trader;
    
                expect(liquidatePositionEvent.id).to.equal(position.id);
                expect(liquidatePositionEvent.principalRepaid!).to.equal(position.principal);
    
                // Check trader has been paid
                expect(ethBalancesAfter.get(trader) - ethBalancesBefore.get(trader)).to.equal(liquidatePositionEvent.payout!);

                feesToBePaid += position.feesToBePaid;
                totalFeesPaid += liquidatePositionEvent.feeAmount! + position.feesToBePaid;
                totalPrincipalRepaid += liquidatePositionEvent.principalRepaid!;
                totalInterestPaid += liquidatePositionEvent.interestPaid!;
            }

            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");
            expect(balancesBefore.get(wasabiLongPool.address) + totalPrincipalRepaid + totalInterestPaid - feesToBePaid).to.equal(balancesAfter.get(wasabiLongPool.address)!);

            // Check fees have been paid
            expect(ethBalancesAfter.get(feeReceiver) - ethBalancesBefore.get(feeReceiver)).to.equal(totalFeesPaid);
        });
    });

    describe("Claim Position", function () {
        it("Claim successfully", async function () {
            const { sendDefaultOpenPositionRequest, computeMaxInterest, weth, publicClient, wasabiLongPool, user1, user2, uPPG, mockSwap, feeReceiver, wethAddress, openPositionRequest, contractName, computeLiquidationPrice } = await loadFixture(deployLongPoolMockEnvironment);
            
            const poolBalanceInitial = 
                await getBalance(publicClient, zeroAddress, wasabiLongPool.address) 
                    + await getBalance(publicClient, weth.address, wasabiLongPool.address);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Claim Position
            const closeFee = position.feesToBePaid;
            const interest = await computeMaxInterest(position);
            const amountToPay = position.principal + interest + closeFee;

            const poolBalanceBefore = 
                await getBalance(publicClient, zeroAddress, wasabiLongPool.address) 
                    + await getBalance(publicClient, weth.address, wasabiLongPool.address);

            await wasabiLongPool.write.claimPosition([position], { account: user1.account, value: amountToPay });

            const poolBalanceAfter = 
                await getBalance(publicClient, zeroAddress, wasabiLongPool.address) 
                    + await getBalance(publicClient, weth.address, wasabiLongPool.address);

            expect(poolBalanceAfter - poolBalanceBefore).to.equal(position.principal + interest - position.feesToBePaid);
            expect(await getBalance(publicClient, uPPG.address, wasabiLongPool.address)).to.equal(0n, "Pool should not have any collateral left");
            expect(await getBalance(publicClient, uPPG.address, user1.account.address)).to.equal(position.collateralAmount, "Pool should not have any collateral left");

            expect(poolBalanceAfter - poolBalanceInitial).to.equal(interest, 'The position should have increased the pool balance by the interest amount');

            const events = await wasabiLongPool.getEvents.PositionClaimed();
            expect(events).to.have.lengthOf(1);
            const claimPositionEvent = events[0].args!;
            expect(claimPositionEvent.id).to.equal(position.id);
            expect(claimPositionEvent.principalRepaid!).to.equal(position.principal);
            expect(claimPositionEvent.interestPaid!).to.equal(interest);
            expect(claimPositionEvent.feeAmount!).to.equal(closeFee);
        });
    });

})
