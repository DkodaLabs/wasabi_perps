import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { getAddress, parseEther, maxUint256, zeroAddress, parseUnits } from "viem";
import { FunctionCallData, OpenPositionRequest, getFee, PayoutType } from "./utils/PerpStructUtils";
import { getApproveAndSwapExactlyOutFunctionCallData, getApproveAndSwapFunctionCallData } from "./utils/SwapUtils";
import { deployShortPoolMockEnvironment, deployPoolsAndRouterMockEnvironment } from "./fixtures";
import { getBalance, takeBalanceSnapshot } from "./utils/StateUtils";
import { signOpenPositionRequest } from "./utils/SigningUtils";

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

        it("Open Position with USDC", async function () {
            const { wasabiShortPool, publicClient, usdc, upgradeToV2, sendUSDCOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
            const positionId = 1337n;

            const wasabiShortPoolV2 = await upgradeToV2();
            await wasabiShortPoolV2.write.addQuoteToken([usdc.address]);

            const {position, event, downPayment} = await sendUSDCOpenPositionRequest(positionId);
            expect(event.args.positionId).to.equal(positionId);
            expect(event.args.downPayment).to.equal(downPayment);
            expect(event.args.collateralAmount! + event.args.feesToBePaid!).to.equal(await getBalance(publicClient, usdc.address, wasabiShortPool.address), "Collateral amount + fees to be paid should be equal to the amount of USDC in the pool after opening the position");
        });
        
        it("Open Position on behalf of another user", async function () {
            const { wasabiShortPool, tradeFeeValue, publicClient, user1, user2, openPositionRequest, downPayment, signature, wethAddress, totalAmountIn } = await loadFixture(deployShortPoolMockEnvironment);

            const tokenBalancesInitial = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, user2.account.address);

            const hash = await wasabiShortPool.write.openPosition([openPositionRequest, signature, user2.account.address], { account: user1.account });

            const tokenBalancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, user2.account.address);

            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed);
            console.log('gas used to open', gasUsed);

            const events = await wasabiShortPool.getEvents.PositionOpened();
            expect(events).to.have.lengthOf(1);
            const event = events[0].args;
            expect(event.positionId).to.equal(openPositionRequest.id);
            expect(event.downPayment).to.equal(downPayment);
            expect(event.collateralAmount! + event.feesToBePaid!).to.equal(await getBalance(publicClient, wethAddress, wasabiShortPool.address));

            expect(tokenBalancesAfter.get(user1.account.address)).to.equal(tokenBalancesInitial.get(user1.account.address) - totalAmountIn, "User 1 should have spent down payment and fee");
            expect(tokenBalancesAfter.get(user2.account.address)).to.equal(tokenBalancesInitial.get(user2.account.address), "User 2 should not have spent any funds");
            expect(String(event.trader).toLowerCase()).to.equal(user2.account.address, "Position should be opened on behalf of user 2");
        });

        it("Open Position w/ Vault Deposit", async function () {
            const { sendRouterShortOpenPositionRequest, user1, orderExecutor, wethVault, wethAddress, wasabiShortPool, wasabiLongPool, publicClient, executionFee, totalAmountIn } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            // Deposit into WETH Vault
            await wethVault.write.depositEth(
                [user1.account.address], 
                { value: parseEther("50"), account: user1.account }
            );

            const wethBalancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, wethVault.address, orderExecutor.account.address);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const orderExecutorBalanceBefore = await publicClient.getBalance({ address: orderExecutor.account.address });
            const userVaultSharesBefore = await wethVault.read.balanceOf([user1.account.address]);
            const expectedSharesSpent = await wethVault.read.convertToShares([totalAmountIn + executionFee]);

            const {position, gasUsed} = await sendRouterShortOpenPositionRequest();

            const wethBalancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, wethVault.address, orderExecutor.account.address);
            const userBalanceAfter = await publicClient.getBalance({ address: user1.account.address });
            const orderExecutorBalanceAfter = await publicClient.getBalance({ address: orderExecutor.account.address });
            const userVaultSharesAfter = await wethVault.read.balanceOf([user1.account.address]);
            
            expect(orderExecutorBalanceAfter).to.equal(orderExecutorBalanceBefore - gasUsed, "Order signer should have spent gas");
            expect(userBalanceAfter).to.equal(userBalanceBefore, "User should not have spent gas");
            expect(wethBalancesAfter.get(user1.account.address)).to.equal(wethBalancesBefore.get(user1.account.address), "User should not have spent WETH from their account");
            expect(wethBalancesAfter.get(wethVault.address)).to.equal(wethBalancesBefore.get(wethVault.address) - totalAmountIn - executionFee, "WETH down payment + fees should have been transferred from WETH vault");
            expect(wethBalancesAfter.get(wasabiShortPool.address)).to.equal(wethBalancesBefore.get(wasabiShortPool.address) + position.collateralAmount + position.feesToBePaid, "WETH collateral should have been transferred to short pool");
            expect(userVaultSharesAfter).to.equal(userVaultSharesBefore - expectedSharesSpent, "User's vault shares should have been burned");
            expect(wethBalancesAfter.get(orderExecutor.account.address)).to.equal(wethBalancesBefore.get(orderExecutor.account.address) + executionFee, "Fee receiver should have received execution fee");
        });
    });

    describe("Close Position", function () {
        it("Price Not Changed", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, wethAddress, vault } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const vaultBalanceInitial = await getBalance(publicClient, uPPG.address, vault.address);
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n * 3n); // 1 day later

            // Close Position
            const maxInterest = await computeMaxInterest(position);
            const { request, signature } = await createSignedClosePositionRequest({ position, interest: maxInterest });
            
            const vaultBalanceBefore = await getBalance(publicClient, uPPG.address, vault.address);
            const balancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({ address: feeReceiver });
        
            const hash = await wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            const vaultBalanceAfter = await getBalance(publicClient, uPPG.address, vault.address);
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

            // Interest is paid in uPPG, so the principal should be equal before and after the trade
            expect(vaultBalanceAfter).eq(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
            expect(vaultBalanceInitial + closePositionEvent.interestPaid!).eq(vaultBalanceAfter, "Original amount + interest wasn't repayed");

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
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, wethAddress, vault } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const vaultBalanceInitial = await getBalance(publicClient, uPPG.address, vault.address);
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Close Position
            const maxInterest = await computeMaxInterest(position);
            const interest = maxInterest / 2n;
            const { request, signature } = await createSignedClosePositionRequest({ position, interest });

            const vaultBalanceBefore = await getBalance(publicClient, uPPG.address, vault.address);
            const balancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({ address: feeReceiver });
        
            const hash = await wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            const vaultBalanceAfter = await getBalance(publicClient, uPPG.address, vault.address);
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
            expect(vaultBalanceAfter).eq(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
            expect(vaultBalanceInitial + closePositionEvent.interestPaid!).eq(vaultBalanceAfter, "Original amount + interest wasn't repayed");

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

        it("Price Decreased - USDC payout", async function () {
            const { wasabiShortPool, vault, usdc, uPPG, mockSwap, wethAddress, initialPPGPrice, initialUSDCPrice, priceDenominator, user1, feeReceiver, publicClient, upgradeToV2, sendUSDCOpenPositionRequest, computeMaxInterest, createSignedClosePositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
            const positionId = 1337n;

            const wasabiShortPoolV2 = await upgradeToV2();
            await wasabiShortPoolV2.write.addQuoteToken([usdc.address]);

            // Open Position with USDC
            const vaultBalanceInitial = await getBalance(publicClient, uPPG.address, vault.address);
            const {position} = await sendUSDCOpenPositionRequest(positionId);
            expect(position.trader).to.equal(user1.account.address);

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 2n]); // price halved
            await mockSwap.write.setPrice([usdc.address, uPPG.address, initialUSDCPrice * 2n]); // price halved

            // Close Position
            const maxInterest = await computeMaxInterest(position);
            const { request, signature } = await createSignedClosePositionRequest({ position, interest: maxInterest });
            expect(request.position.trader).to.equal(user1.account.address);
            
            const vaultBalanceBefore = await getBalance(publicClient, uPPG.address, vault.address);
            const balancesBefore = await takeBalanceSnapshot(publicClient, usdc.address, user1.account.address, wasabiShortPool.address, feeReceiver);
        
            const hash = await wasabiShortPool.write.closePosition(
                [PayoutType.UNWRAPPED, request, signature],
                { account: user1.account }
            );

            const vaultBalanceAfter = await getBalance(publicClient, uPPG.address, vault.address);
            const balancesAfter = await takeBalanceSnapshot(publicClient, usdc.address, user1.account.address, wasabiShortPool.address, feeReceiver);

            // Checks
            const events = await wasabiShortPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(closePositionEvent.interestPaid!).to.equal(maxInterest, "If given interest value is 0, should use max interest");
            
            // Interest is paid in uPPG, so the principal should be equal before and after the trade
            expect(vaultBalanceAfter).eq(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
            expect(vaultBalanceInitial + closePositionEvent.interestPaid!).eq(vaultBalanceAfter, "Original amount + interest wasn't repayed");

            expect(balancesAfter.get(wasabiShortPool.address)).to.equal(0, "Short pool should not have any collateral left");

            const interestPaidInEth = closePositionEvent.interestPaid! / 2n;
            const interestPaidInUsdc =
                interestPaidInEth * priceDenominator / initialUSDCPrice / (10n ** (18n - 6n));
            const totalReturn = closePositionEvent.payout! + closePositionEvent.feeAmount! - position.downPayment + interestPaidInUsdc;
            expect(totalReturn).to.equal(position.downPayment * 5n / 2n, "On 50% price decrease w/ 5x leverage, total return should be 2.5x down payment");

            // Check trader has been paid
            expect(balancesAfter.get(user1.account.address) - balancesBefore.get(user1.account.address)).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;
            expect(balancesAfter.get(feeReceiver) - balancesBefore.get(feeReceiver)).to.equal(totalFeesPaid);
        });

        it("Price Increased - USDC vault deposit", async function () {
            const { wasabiShortPool, wasabiLongPool, usdc, uPPG, mockSwap, wethAddress, initialPPGPrice, initialUSDCPrice, priceDenominator, usdcVault, vault, user1, feeReceiver, publicClient, upgradeToV2, sendUSDCOpenPositionRequest, computeMaxInterest, createSignedClosePositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
            const positionId = 1337n;

            const wasabiShortPoolV2 = await upgradeToV2();
            await wasabiShortPoolV2.write.addQuoteToken([usdc.address]);

            // Open Position with USDC
            const vaultBalanceInitial = await getBalance(publicClient, uPPG.address, vault.address);
            const {position} = await sendUSDCOpenPositionRequest(positionId);
            expect(position.trader).to.equal(user1.account.address);

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 2n]); // price halved
            await mockSwap.write.setPrice([usdc.address, uPPG.address, initialUSDCPrice * 2n]); // price halved

            // Close Position
            const maxInterest = await computeMaxInterest(position);
            const { request, signature } = await createSignedClosePositionRequest({ position, interest: maxInterest });
            expect(request.position.trader).to.equal(user1.account.address);
            
            const vaultBalanceBefore = await getBalance(publicClient, uPPG.address, vault.address);
            const usdcBalancesBefore = await takeBalanceSnapshot(publicClient, usdc.address, user1.account.address, wasabiShortPool.address, usdcVault.address, feeReceiver);
            const usdcVaultSharesBefore = await takeBalanceSnapshot(publicClient, usdcVault.address, user1.account.address);
        
            const hash = await wasabiShortPool.write.closePosition(
                [PayoutType.VAULT_DEPOSIT, request, signature],
                { account: user1.account }
            );

            const vaultBalanceAfter = await getBalance(publicClient, uPPG.address, vault.address);
            const usdcBalancesAfter = await takeBalanceSnapshot(publicClient, usdc.address, user1.account.address, wasabiShortPool.address, usdcVault.address, feeReceiver);
            const usdcVaultSharesAfter = await takeBalanceSnapshot(publicClient, usdcVault.address, user1.account.address);

            // Checks
            const events = await wasabiShortPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            
            // Interest is paid in uPPG, so the principal should be equal before and after the trade
            expect(vaultBalanceAfter).eq(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
            expect(vaultBalanceInitial + closePositionEvent.interestPaid!).eq(vaultBalanceAfter, "Original amount + interest wasn't repayed");

            expect(usdcBalancesAfter.get(wasabiShortPool.address)).to.equal(0, "Short pool should not have any collateral left");
            expect(usdcBalancesAfter.get(usdcVault.address)).to.equal(closePositionEvent.payout!, "USDC vault should have received the payout");

            const interestPaidInEth = closePositionEvent.interestPaid! / 2n;
            const interestPaidInUsdc =
                interestPaidInEth * priceDenominator / initialUSDCPrice / (10n ** (18n - 6n));
            const totalReturn = closePositionEvent.payout! + closePositionEvent.feeAmount! - position.downPayment + interestPaidInUsdc;
            expect(totalReturn).to.equal(position.downPayment * 5n / 2n, "On 50% price decrease w/ 5x leverage, total return should be 2.5x down payment");

            // Check trader has received vault shares, not USDC
            const expectedNewVaultShares = await usdcVault.read.convertToShares([closePositionEvent.payout!]);
            expect(usdcVaultSharesAfter.get(user1.account.address) - usdcVaultSharesBefore.get(user1.account.address)).to.equal(expectedNewVaultShares);

            // Check fees have been paid
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;
            expect(usdcBalancesAfter.get(feeReceiver) - usdcBalancesBefore.get(feeReceiver)).to.equal(totalFeesPaid);
        });
    });

    describe("Liquidate Position", function () {
        it("liquidate", async function () {
            const { vault, sendDefaultOpenPositionRequest, liquidator, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, liquidationFeeReceiver, wethAddress, computeLiquidationPrice } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const vaultBalanceInitial = await getBalance(publicClient, uPPG.address, vault.address);
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            const maxInterest = await computeMaxInterest(position);
            const functionCallDataList = getApproveAndSwapExactlyOutFunctionCallData(
                mockSwap.address,
                position.collateralCurrency,
                position.currency,
                position.collateralAmount,
                position.principal + maxInterest);

            await expect(wasabiShortPool.write.liquidatePosition([PayoutType.UNWRAPPED, maxInterest, position, functionCallDataList], { account: liquidator.account }))
                .to.be.rejectedWith("LiquidationThresholdNotReached", "Cannot liquidate position if liquidation price is not reached");

            // Liquidate Position
            const liquidationPrice = await computeLiquidationPrice(position);
            await mockSwap.write.setPrice([uPPG.address, wethAddress, liquidationPrice - 1n]); 

            const vaultBalanceBefore = await getBalance(publicClient, uPPG.address, vault.address);
            const balancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, feeReceiver, liquidationFeeReceiver);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({ address: feeReceiver });
            const liquidationFeeReceiverBalanceBefore = await publicClient.getBalance({address: liquidationFeeReceiver });    

            const hash = await wasabiShortPool.write.liquidatePosition([PayoutType.UNWRAPPED, maxInterest, position, functionCallDataList], { account: liquidator.account });

            const vaultBalanceAfter = await getBalance(publicClient, uPPG.address, vault.address);
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
            expect(vaultBalanceAfter).eq(vaultBalanceBefore + liquidateEvent.principalRepaid! + liquidateEvent.interestPaid!, "Invalid repay amount");
            expect(vaultBalanceInitial + liquidateEvent.interestPaid!).eq(vaultBalanceAfter, "Original amount + interest wasn't repayed");

            expect(balancesAfter.get(wasabiShortPool.address)).to.equal(0);

            // const totalReturn = liquidateEvent.payout! + liquidateEvent.interestPaid! + liquidateEvent.feeAmount! - position.downPayment;
            // expect(totalReturn).to.equal(0, "Total return should be 0 on no price change");

            expect(userBalanceAfter - userBalanceBefore).to.equal(liquidateEvent.payout!);

            // Check fees have been paid
            const totalFeesPaid = liquidateEvent.feeAmount! + position.feesToBePaid;
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);

            // Check liquidation fee receiver balance
            const liquidationFeeExpected = position.downPayment * 5n / 100n;
            expect(liquidationFeeReceiverBalanceAfter - liquidationFeeReceiverBalanceBefore).to.equal(liquidationFeeExpected);
        });

        it("liqudateWithNoPayout", async function () {
            const { sendDefaultOpenPositionRequest, computeMaxInterest, owner, publicClient, wasabiShortPool, user1, uPPG, mockSwap, feeReceiver, liquidationFeeReceiver, wethAddress, liquidator, computeLiquidationPrice } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            const maxInterest = await computeMaxInterest(position);
            const functionCallDataList = getApproveAndSwapFunctionCallData(
                mockSwap.address,
                position.collateralCurrency,
                position.currency,
                position.collateralAmount);

            let liquidationPrice = (position.principal + maxInterest) * 10_000n / position.collateralAmount;

            console.log('liquidationPrice', liquidationPrice.toString());
            await mockSwap.write.setPrice([wethAddress, uPPG.address, liquidationPrice]); 
            
            await wasabiShortPool.write.liquidatePosition([PayoutType.UNWRAPPED, maxInterest, position, functionCallDataList], { account: liquidator.account });
    
            // Checks for no payout
            const events = await wasabiShortPool.getEvents.PositionLiquidated();
            expect(events).to.have.lengthOf(1);
            const liquidatePositionEvent = events[0].args;
            expect(liquidatePositionEvent.payout!).to.equal(0n);
        });
    });


    describe("Claim Position", function () {
        it("Claim successfully", async function () {
            const { owner, sendDefaultOpenPositionRequest, createSignedClosePositionRequest, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, vault, wethAddress, computeLiquidationPrice } = await loadFixture(deployShortPoolMockEnvironment);

            await uPPG.write.mint([user1.account.address, parseEther("50")]);
            const initialUserUPPGBalance = await uPPG.read.balanceOf([user1.account.address]);

            const vaultBalanceInitial = await getBalance(publicClient, uPPG.address, vault.address);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            const vaultBalanceBefore = await getBalance(publicClient, uPPG.address, vault.address);

            await time.increase(86400n); // 1 day later

            await uPPG.write.approve([wasabiShortPool.address, maxUint256], { account: user1.account });

            const interest = await computeMaxInterest(position);
            const amountToPay = position.principal + interest;

            const traderBalanceBefore = await getBalance(publicClient, zeroAddress, user1.account.address);

            const hash = await wasabiShortPool.write.claimPosition([position], { account: user1.account });

            const traderBalanceAfter = await getBalance(publicClient, zeroAddress, user1.account.address);

            const vaultBalanceAfter = await getBalance(publicClient, uPPG.address, vault.address);

            expect(vaultBalanceAfter - vaultBalanceBefore).to.equal(position.principal + interest);
            expect(await getBalance(publicClient, zeroAddress, wasabiShortPool.address)).to.equal(0n, "Pool should not have any collateral left");
            expect(vaultBalanceAfter - vaultBalanceInitial).to.equal(interest, 'The position should have increased the pool balance by the interest amount');

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
