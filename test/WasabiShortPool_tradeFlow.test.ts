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
            const { wasabiShortPool, publicClient, usdc, sendUSDCOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
            const positionId = 1337n;

            await wasabiShortPool.write.addQuoteToken([usdc.address]);

            const {position, event, downPayment} = await sendUSDCOpenPositionRequest(positionId);
            expect(event.args.positionId).to.equal(positionId);
            expect(event.args.downPayment).to.equal(downPayment);
            expect(event.args.collateralAmount! + event.args.feesToBePaid!).to.equal(await getBalance(publicClient, usdc.address, wasabiShortPool.address), "Collateral amount + fees to be paid should be equal to the amount of USDC in the pool after opening the position");
        });

        it("Open and Increase Position", async function () {
            const { wasabiShortPool, user1, totalAmountIn, principal, initialPPGPrice, priceDenominator, wethAddress, vault, mockSwap, uPPG, weth, orderSigner, contractName, sendDefaultOpenPositionRequest, computeMaxInterest } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();
            const totalAssetValueBefore = await vault.read.totalAssetValue();

            await time.increase(86400n); // 1 day later

            const interest = await computeMaxInterest(position);
            const functionCallDataList: FunctionCallData[] =
                getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principal - interest);
            const openPositionRequest: OpenPositionRequest = {
                id: position.id,
                currency: position.currency,
                targetCurrency: position.collateralCurrency,
                downPayment: position.downPayment,
                principal: position.principal,
                minTargetAmount: (principal - interest) * initialPPGPrice / priceDenominator,
                expiration: BigInt(await time.latest()) + 86400n,
                fee: position.feesToBePaid,
                functionCallDataList,
                existingPosition: position,
                interestToPay: interest
            };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, openPositionRequest);

            // Increase Position
            await wasabiShortPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account });

            const events = await wasabiShortPool.getEvents.PositionIncreased();
            expect(events).to.have.lengthOf(1);
            const eventData = events[0].args;
            expect(eventData.id).to.equal(position.id);
            expect(eventData.newDownPayment).to.equal(totalAmountIn - eventData.newFees!);
            expect(eventData.newPrincipal).to.equal(openPositionRequest.principal);
            expect(eventData.newCollateral! + eventData.newFees! + position.collateralAmount + position.feesToBePaid).to.equal(await weth.read.balanceOf([wasabiShortPool.address]));
            expect(eventData.newCollateral).to.greaterThanOrEqual(openPositionRequest.minTargetAmount);
            expect(eventData.interestPaid).to.equal(interest);
            const totalAssetValueAfter = await vault.read.totalAssetValue();
            expect(totalAssetValueAfter - totalAssetValueBefore).to.equal(interest);
        });

        it("Open Position and Add Collateral", async function () {
            const { wasabiShortPool, tradeFeeValue, publicClient, user1, downPayment, principal, initialPPGPrice, priceDenominator, wethAddress, vault, mockSwap, uPPG, weth, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();
            const totalAssetValueBefore = await vault.read.totalAssetValue();

            await time.increase(86400n); // 1 day later

            const openPositionRequest: OpenPositionRequest = {
                id: position.id,
                currency: position.currency,
                targetCurrency: position.collateralCurrency,
                downPayment,
                principal: 0n,
                minTargetAmount: 0n,
                expiration: BigInt(await time.latest()) + 86400n,
                fee: 0n,
                functionCallDataList: [],
                existingPosition: position,
                interestToPay: 0n
            };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, openPositionRequest);

            // Add Collateral
            await wasabiShortPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account });

            const events = await wasabiShortPool.getEvents.CollateralAddedToPosition();
            expect(events).to.have.lengthOf(1);
            const eventData = events[0].args;
            expect(eventData.id).to.equal(position.id);
            expect(eventData.newCollateralAmount! + position.collateralAmount + position.feesToBePaid).to.equal(await weth.read.balanceOf([wasabiShortPool.address]));
            expect(eventData.newCollateralAmount).to.equal(downPayment);
            const totalAssetValueAfter = await vault.read.totalAssetValue();
            expect(totalAssetValueAfter).to.equal(totalAssetValueBefore);
        });
    });

    describe("Close Position", function () {
        it("Price Not Changed", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, wethAddress, vault } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const vaultBalanceInitial = await getBalance(publicClient, uPPG.address, vault.address);
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n * 3n); // 3 days later

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
            const { wasabiShortPool, vault, usdc, uPPG, mockSwap, wethAddress, initialPPGPrice, initialUSDCPrice, priceDenominator, user1, feeReceiver, publicClient, sendUSDCOpenPositionRequest, computeMaxInterest, createSignedClosePositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
            const positionId = 1337n;

            await wasabiShortPool.write.addQuoteToken([usdc.address]);

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

        it("Price Decreased - USDC vault deposit", async function () {
            const { wasabiShortPool, usdc, uPPG, mockSwap, wethAddress, initialPPGPrice, initialUSDCPrice, priceDenominator, usdcVault, vault, user1, feeReceiver, publicClient, sendUSDCOpenPositionRequest, computeMaxInterest, createSignedClosePositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
            const positionId = 1337n;

            await wasabiShortPool.write.addQuoteToken([usdc.address]);

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

        describe("Partial Close", function () {
            it("Price Not Changed", async function () {
                const { sendDefaultOpenPositionRequest, createClosePositionRequest, signClosePositionRequest, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, orderSigner, contractName, wethAddress, vault } = await loadFixture(deployShortPoolMockEnvironment);
    
                // Open Position
                const vaultBalanceInitial = await getBalance(publicClient, uPPG.address, vault.address);
                const {position} = await sendDefaultOpenPositionRequest();
                // console.log('position', position);
    
                await time.increase(86400n * 3n); // 3 days later
    
                // Close Half of the Position
                const closeAmountDenominator = 2n;
                const maxInterest = await computeMaxInterest(position);
                const amount = position.principal / closeAmountDenominator;
                const request = await createClosePositionRequest({ position, interest: maxInterest, amount }); 
                const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);
                
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
                const events = await wasabiShortPool.getEvents.PositionDecreased();
                expect(events).to.have.lengthOf(1);
                const closePositionEvent = events[0].args;

                const swap = (await mockSwap.getEvents.Swap())[0]!.args!;
                // console.log('swap', swap);
        
                expect(closePositionEvent.id).to.equal(position.id);
                expect(closePositionEvent.principalRepaid!).to.equal(position.principal / closeAmountDenominator, "Half of the principal should be repaid");
                expect(closePositionEvent.interestPaid!).to.equal(maxInterest, "Max interest should be paid");
    
                // Interest is paid in uPPG, so the principal should be equal before and after the trade
                expect(vaultBalanceAfter).eq(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
                expect(vaultBalanceInitial + closePositionEvent.interestPaid! - position.principal / closeAmountDenominator).eq(vaultBalanceAfter, "Half of original amount + interest wasn't repayed");
    
                expect(balancesAfter.get(wasabiShortPool.address)).to.equal(balancesBefore.get(wasabiShortPool.address) / closeAmountDenominator, "Pool should have half of the collateral left");
    
                const adjDownPayment = position.downPayment / closeAmountDenominator;
                const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.closeFee! - adjDownPayment;
                expect(totalReturn).to.equal(0, "Total return should be 0 on no price change");
    
                // Check trader has been paid
                const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
                expect(userBalanceAfter - userBalanceBefore).to.equal(closePositionEvent.payout! - gasUsed);
    
                // Check fees have been paid
                const totalFeesPaid = closePositionEvent.closeFee! + closePositionEvent.pastFees!;
                expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
            });

            it("Price Decreased", async function () {
                const { sendDefaultOpenPositionRequest, createClosePositionRequest, signClosePositionRequest, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, orderSigner, contractName, initialPPGPrice, wethAddress, vault } = await loadFixture(deployShortPoolMockEnvironment);
    
                // Open Position
                const vaultBalanceInitial = await getBalance(publicClient, uPPG.address, vault.address);
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later
                
                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice / 2n]); // price halved
                
                // Close Half of the Position
                const closeAmountDenominator = 2n;
                const maxInterest = await computeMaxInterest(position);
                const amount = position.principal / closeAmountDenominator;
                const amountIn = (amount + maxInterest) / 2n; // It should cost half as much WETH to buy back half the principal plus interest
                const request = await createClosePositionRequest({ position, interest: maxInterest, amount }); 
                const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

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
                const events = await wasabiShortPool.getEvents.PositionDecreased();
                expect(events).to.have.lengthOf(1);
                const closePositionEvent = events[0].args;

                expect(closePositionEvent.id).to.equal(position.id);
                expect(closePositionEvent.principalRepaid!).to.equal(position.principal / closeAmountDenominator, "Half of the principal should be repaid");
                expect(closePositionEvent.interestPaid!).to.equal(maxInterest, "Max interest should be paid");

                // Interest is paid in uPPG, so the principal should be equal before and after the trade
                expect(vaultBalanceAfter).eq(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
                expect(vaultBalanceInitial + closePositionEvent.interestPaid! - position.principal / closeAmountDenominator).eq(vaultBalanceAfter, "Half of original amount + interest wasn't repayed");
    
                expect(balancesAfter.get(wasabiShortPool.address)).to.equal(balancesBefore.get(wasabiShortPool.address) / closeAmountDenominator, "Pool should have half of the collateral left");

                const adjDownPayment = position.downPayment / closeAmountDenominator;
                const interestPaidInEth = closePositionEvent.interestPaid! / 2n;
                const totalReturn = closePositionEvent.payout! + interestPaidInEth + closePositionEvent.closeFee! - adjDownPayment;
                expect(totalReturn).to.equal(adjDownPayment * 5n / 2n, "On 50% price decrease w/ 5x leverage, total return should be 2.5x adjusted down payment");

                // Check trader has been paid
                const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
                expect(userBalanceAfter - userBalanceBefore).to.equal(closePositionEvent.payout! - gasUsed);
    
                // Check fees have been paid
                const totalFeesPaid = closePositionEvent.closeFee! + closePositionEvent.pastFees!;
                expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
            });

            it("Price Increased", async function () {
                const { sendDefaultOpenPositionRequest, createClosePositionRequest, signClosePositionRequest, computeMaxInterest, mockSwap, publicClient, wasabiShortPool, user1, uPPG, feeReceiver, orderSigner, contractName, initialPPGPrice, wethAddress, vault } = await loadFixture(deployShortPoolMockEnvironment);
    
                // Open Position
                const vaultBalanceInitial = await getBalance(publicClient, uPPG.address, vault.address);
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice * 11n / 10n]); // price rose by 10%

                // Close Half of the Position
                const closeAmountDenominator = 2n;
                const maxInterest = await computeMaxInterest(position);
                const amount = position.principal / closeAmountDenominator;
                const request = await createClosePositionRequest({ position, interest: maxInterest, amount }); 
                const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

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
                const events = await wasabiShortPool.getEvents.PositionDecreased();
                expect(events).to.have.lengthOf(1);
                const closePositionEvent = events[0].args;

                const swap = (await mockSwap.getEvents.Swap())[0]!.args!;

                expect(closePositionEvent.id).to.equal(position.id);
                expect(closePositionEvent.principalRepaid!).to.equal(position.principal / closeAmountDenominator, "Half of the principal should be repaid");
                expect(closePositionEvent.interestPaid!).to.equal(maxInterest, "Max interest should be paid");

                // Interest is paid in uPPG, so the principal should be equal before and after the trade
                expect(vaultBalanceAfter).eq(vaultBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid!, "Invalid repay amount");
                expect(vaultBalanceInitial + closePositionEvent.interestPaid! - position.principal / closeAmountDenominator).eq(vaultBalanceAfter, "Half of original amount + interest wasn't repayed");
    
                expect(balancesAfter.get(wasabiShortPool.address)).to.equal(balancesBefore.get(wasabiShortPool.address) / closeAmountDenominator, "Pool should have half of the collateral left");

                const adjDownPayment = position.downPayment / closeAmountDenominator;
                const interestPaidInEth = closePositionEvent.interestPaid! * 11n / 10n;
                const totalReturn = closePositionEvent.payout! + interestPaidInEth + closePositionEvent.closeFee! - adjDownPayment;
                expect(totalReturn).to.be.approximately(adjDownPayment / -2n, parseEther("0.001"), "On 10% price increase w/ 5x leverage, total return should be approximately -0.5x down payment");

                // Check trader has been paid
                const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
                expect(userBalanceAfter - userBalanceBefore).to.equal(closePositionEvent.payout! - gasUsed);
    
                // Check fees have been paid
                const totalFeesPaid = closePositionEvent.closeFee! + closePositionEvent.pastFees!;
                expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
            });
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
