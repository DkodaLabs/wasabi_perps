import {
    loadFixture,
    time,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { deployPoolsAndRouterMockEnvironment } from "./fixtures";
import { signClosePositionRequest } from "./utils/SigningUtils";
import { takeBalanceSnapshot } from "./utils/StateUtils";
import { getERC20ApproveFunctionCallData, getRouterSwapFunctionCallData, getExactOutSwapperFunctionCallData, getSwapExactlyOutFunctionCallData, getExactOutSwapperV2FunctionCallData } from "./utils/SwapUtils";
import { ClosePositionRequest, FunctionCallData, PayoutType } from "./utils/PerpStructUtils";
import { getAddress, parseEther, parseUnits, zeroAddress } from "viem";

describe("ExactOutSwapperV2", function () {
    describe("Exact Out Swaps", function () {
        it("Close Short Position With Exact Out Swap", async function () {
            const { user1, owner, orderSigner, wasabiShortPool, exactOutSwapperV2, weth, uPPG, mockSwap, mockSwapRouter, initialPPGPrice, sendDefaultShortOpenPositionRequest, computeShortMaxInterest } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            const {position} = await sendDefaultShortOpenPositionRequest();

            // Set buyback discount to 0.1%
            await exactOutSwapperV2.write.setBuybackDiscountBips([uPPG.address, weth.address, 10n], { account: owner.account });

            await time.increase(86400n * 3n); // 1 day later

            // Price decrease by 20%
            const newPPGPrice = initialPPGPrice * 8n / 10n;
            await mockSwap.write.setPrice([uPPG.address, weth.address, newPPGPrice], { account: owner.account });

            // Prepare to Close Position
            const maxInterest = await computeShortMaxInterest(position);
            const expectedAmountOut = maxInterest + position.principal;
            const expectedAmountIn = expectedAmountOut * newPPGPrice / 10_000n;
            
            // Encode swap
            const swapCalldata = getRouterSwapFunctionCallData(mockSwapRouter.address, weth.address, uPPG.address, position.collateralAmount, exactOutSwapperV2.address);

            // Encode ClosePositionRequest
            const functionCallDataList: FunctionCallData[] = [
                getERC20ApproveFunctionCallData(weth.address, exactOutSwapperV2.address, position.collateralAmount),
                getExactOutSwapperV2FunctionCallData(exactOutSwapperV2.address, weth.address, uPPG.address, position.collateralAmount, expectedAmountOut, swapCalldata),
            ];
            const request: ClosePositionRequest = {
                expiration: (BigInt(await time.latest()) + 300n),
                amount: 0n,
                interest: maxInterest,
                position,
                functionCallDataList,
                referrer: zeroAddress
            };
            const signature = await signClosePositionRequest(orderSigner, "WasabiShortPool", wasabiShortPool.address, request)

            // Close position
            const hash = await wasabiShortPool.write.closePosition([PayoutType.WRAPPED, request, signature], { account: user1.account });

            // PositionClosed event checks
            const closeEvents = await wasabiShortPool.getEvents.PositionClosed();
            expect(closeEvents).to.have.lengthOf(1);
            const closeEvent = closeEvents[0];

            expect(closeEvent.args.principalRepaid).to.equal(position.principal, "Principal should be repaid");
            expect(closeEvent.args.interestPaid).to.equal(maxInterest, "Interest should be paid");
            expect(closeEvent.args.payout).to.be.gt(0n, "Payout should be greater than 0");

            // Swap event checks
            const swapEvents = await mockSwap.getEvents.Swap();
            expect(swapEvents).to.have.lengthOf(1);
            const swapEvent = swapEvents[0];

            expect(swapEvent.args.amountIn).to.equal(position.collateralAmount, "Swap amount in should be equal to collateral amount");

            const buybackEvents = await exactOutSwapperV2.getEvents.ExcessTokensPurchased();
            expect(buybackEvents).to.have.lengthOf(1);
            const buybackEvent = buybackEvents[0];
            expect(buybackEvent.args.buybackAmount).to.be.gt(0n, "Buyback amount should be greater than 0");
            expect(position.collateralAmount - buybackEvent.args.buybackAmount!).to.be.approximately(
                expectedAmountIn, 
                expectedAmountIn / 1000n, 
                "Resulting amount in should be equal to expected amount in, +/- 0.1%"
            );
        });

        describe("Direct Swaps", function () {
            it("Swap WETH -> uPPG", async function () {
                const buybackDiscounts = [1n, 10n, 100n, 1000n];
                for (const buybackDiscount of buybackDiscounts) {
                    console.log("buybackDiscount %f%%", Number(buybackDiscount) / 100);
                    const { owner, exactOutSwapperV2, weth, uPPG, mockSwap, mockSwapRouter, initialPPGPrice, priceDenominator, publicClient } = await loadFixture(deployPoolsAndRouterMockEnvironment);

                    const expectedAmountOut = parseEther("0.9");
                    const amountInMax = parseEther("1");

                    await exactOutSwapperV2.write.setAuthorizedSwapCaller([owner.account.address, true], { account: owner.account });
                    if (buybackDiscount !== 100n) {
                        await exactOutSwapperV2.write.setBuybackDiscountBips([weth.address, uPPG.address, buybackDiscount], { account: owner.account });
                    }
                    await weth.write.approve([exactOutSwapperV2.address, amountInMax], { account: owner.account });

                    const wethBalancesBefore = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, exactOutSwapperV2.address);
                    const uPPGBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, owner.account.address, exactOutSwapperV2.address);

                    const swapCalldata = getRouterSwapFunctionCallData(mockSwapRouter.address, weth.address, uPPG.address, amountInMax, exactOutSwapperV2.address);

                    await exactOutSwapperV2.write.swapExactOut(
                        [weth.address, uPPG.address, amountInMax, expectedAmountOut, swapCalldata.to, swapCalldata.data],
                        { account: owner.account }
                    )

                    const wethBalancesAfter = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, exactOutSwapperV2.address);
                    const uPPGBalancesAfter = await takeBalanceSnapshot(publicClient, uPPG.address, owner.account.address, exactOutSwapperV2.address);

                    const buybackEvents = await exactOutSwapperV2.getEvents.ExcessTokensPurchased();
                    expect(buybackEvents).to.have.lengthOf(1);
                    const buybackEvent = buybackEvents[0];
                    const swapEvents = await mockSwap.getEvents.Swap();
                    expect(swapEvents).to.have.lengthOf(1);
                    const swapEvent = swapEvents[0];

                    expect(swapEvent.args.amountIn).to.equal(amountInMax, "Swap amount in should be equal to amountInMax");
                    expect(swapEvent.args.amountOut).to.equal(
                        amountInMax * priceDenominator / initialPPGPrice, 
                        "Swap amount out should be equal to amountIn * price"
                    );
                    expect(buybackEvent.args.excessAmount).to.equal(
                        amountInMax * priceDenominator / initialPPGPrice - expectedAmountOut, 
                        "Excess amount should be equal to amountInMax * price - expectedAmountOut"
                    );
                    expect(buybackEvent.args.buybackAmount).to.equal(
                        buybackEvent.args.excessAmount! * amountInMax * (10000n - buybackDiscount) / (10000n * swapEvent.args.amountOut!),
                        "Buyback amount should be equal to excess amount * swap price * (1 - buyback discount)"
                    );
                    
                    expect(uPPGBalancesAfter.get(owner.account.address)).to.equal(
                        uPPGBalancesBefore.get(owner.account.address) + expectedAmountOut, 
                        "User should have received exact uPPG to their account"
                    );
                    expect(wethBalancesAfter.get(owner.account.address)).to.equal(
                        wethBalancesBefore.get(owner.account.address) - amountInMax + buybackEvent.args.buybackAmount!, 
                        "User should have spent WETH from their account"
                    );

                    expect(await uPPG.read.balanceOf([exactOutSwapperV2.address])).to.equal(buybackEvent.args.excessAmount!, "uPPG balance of contract should be equal to excess amount");

                    const sellCalldata = getRouterSwapFunctionCallData(mockSwapRouter.address, uPPG.address, weth.address, buybackEvent.args.excessAmount!, exactOutSwapperV2.address);

                    await exactOutSwapperV2.write.sellExistingTokens(
                        [uPPG.address, buybackEvent.args.excessAmount!, mockSwapRouter.address, sellCalldata.data],
                        { account: owner.account }
                    )

                    expect(await uPPG.read.balanceOf([exactOutSwapperV2.address])).to.equal(0n, "uPPG balance of contract should be 0 after selling excess");
                }
            });

            it("Swap WETH -> uPPG (no excess)", async function () {
                const { owner, exactOutSwapperV2, weth, uPPG, mockSwap, mockSwapRouter, initialPPGPrice, priceDenominator, publicClient } = await loadFixture(deployPoolsAndRouterMockEnvironment);

                const expectedAmountOut = parseEther("1");
                const amountInMax = parseEther("1");

                await exactOutSwapperV2.write.setAuthorizedSwapCaller([owner.account.address, true], { account: owner.account });
                await weth.write.approve([exactOutSwapperV2.address, amountInMax], { account: owner.account });

                const wethBalancesBefore = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, exactOutSwapperV2.address);
                const uPPGBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, owner.account.address, exactOutSwapperV2.address);

                const swapCalldata = getRouterSwapFunctionCallData(mockSwapRouter.address, weth.address, uPPG.address, amountInMax, exactOutSwapperV2.address);

                await exactOutSwapperV2.write.swapExactOut(
                    [weth.address, uPPG.address, amountInMax, expectedAmountOut, swapCalldata.to, swapCalldata.data],
                    { account: owner.account }
                )

                const wethBalancesAfter = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, exactOutSwapperV2.address);
                const uPPGBalancesAfter = await takeBalanceSnapshot(publicClient, uPPG.address, owner.account.address, exactOutSwapperV2.address);

                const buybackEvents = await exactOutSwapperV2.getEvents.ExcessTokensPurchased();
                expect(buybackEvents).to.have.lengthOf(0);
                const swapEvents = await mockSwap.getEvents.Swap();
                expect(swapEvents).to.have.lengthOf(1);
                const swapEvent = swapEvents[0];

                expect(swapEvent.args.amountIn).to.equal(amountInMax, "Swap amount in should be equal to amountInMax");
                expect(swapEvent.args.amountOut).to.equal(
                    amountInMax * priceDenominator / initialPPGPrice, 
                    "Swap amount out should be equal to amountIn * price"
                );
                expect(uPPGBalancesAfter.get(owner.account.address)).to.equal(
                    uPPGBalancesBefore.get(owner.account.address) + expectedAmountOut, 
                    "User should have received exact uPPG to their account"
                );
                expect(wethBalancesAfter.get(owner.account.address)).to.equal(
                    wethBalancesBefore.get(owner.account.address) - amountInMax, 
                    "User should have spent WETH from their account"
                );
            });

            it("Swap WETH -> USDC", async function () {
                const buybackDiscounts = [1n, 10n, 100n, 1000n];
                for (const buybackDiscount of buybackDiscounts) {
                    console.log("buybackDiscount %f%%", Number(buybackDiscount) / 100);
                    const { owner, exactOutSwapperV2, weth, usdc, mockSwap, mockSwapRouter, initialUSDCPrice, priceDenominator, publicClient } = await loadFixture(deployPoolsAndRouterMockEnvironment);

                    const expectedAmountOut = parseUnits("2000", 6);
                    const amountInMax = parseEther("1");

                    await exactOutSwapperV2.write.setAuthorizedSwapCaller([owner.account.address, true], { account: owner.account });
                    if (buybackDiscount !== 100n) {
                        await exactOutSwapperV2.write.setBuybackDiscountBips([weth.address, usdc.address, buybackDiscount], { account: owner.account });
                    }
                    await weth.write.approve([exactOutSwapperV2.address, amountInMax], { account: owner.account });

                    const wethBalancesBefore = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, exactOutSwapperV2.address);
                    const usdcBalancesBefore = await takeBalanceSnapshot(publicClient, usdc.address, owner.account.address, exactOutSwapperV2.address);

                    const swapCalldata = getRouterSwapFunctionCallData(mockSwapRouter.address, weth.address, usdc.address, amountInMax, exactOutSwapperV2.address);

                    await exactOutSwapperV2.write.swapExactOut(
                        [weth.address, usdc.address, amountInMax, expectedAmountOut, swapCalldata.to, swapCalldata.data],
                        { account: owner.account }
                    )

                    const wethBalancesAfter = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, exactOutSwapperV2.address);
                    const usdcBalancesAfter = await takeBalanceSnapshot(publicClient, usdc.address, owner.account.address, exactOutSwapperV2.address);

                    const buybackEvents = await exactOutSwapperV2.getEvents.ExcessTokensPurchased();
                    expect(buybackEvents).to.have.lengthOf(1);
                    const buybackEvent = buybackEvents[0];
                    const swapEvents = await mockSwap.getEvents.Swap();
                    expect(swapEvents).to.have.lengthOf(1);
                    const swapEvent = swapEvents[0];

                    expect(swapEvent.args.amountIn).to.equal(amountInMax, "Swap amount in should be equal to amountInMax");
                    expect(swapEvent.args.amountOut).to.equal(
                        amountInMax * priceDenominator / initialUSDCPrice / (10n ** 12n), 
                        "Swap amount out should be equal to amountIn * price"
                    );
                    expect(buybackEvent.args.excessAmount).to.equal(
                        amountInMax * priceDenominator / initialUSDCPrice / (10n ** 12n) - expectedAmountOut, 
                        "Excess amount should be equal to amountInMax * price - expectedAmountOut"
                    );
                    expect(buybackEvent.args.buybackAmount).to.equal(
                        buybackEvent.args.excessAmount! * amountInMax * (10000n - buybackDiscount) / (10000n * swapEvent.args.amountOut!),
                        "Buyback amount should be equal to excess amount * swap price * (1 - buyback discount)"
                    );
                    
                    expect(usdcBalancesAfter.get(owner.account.address)).to.equal(
                        usdcBalancesBefore.get(owner.account.address) + expectedAmountOut, 
                        "User should have received exact USDC to their account"
                    );
                    expect(wethBalancesAfter.get(owner.account.address)).to.equal(
                        wethBalancesBefore.get(owner.account.address) - amountInMax + buybackEvent.args.buybackAmount!, 
                        "User should have spent WETH from their account"
                    );
                }
            });

            it("Swap USDC -> WETH", async function () {
                const buybackDiscounts = [1n, 10n, 100n, 1000n];
                for (const buybackDiscount of buybackDiscounts) {
                    console.log("buybackDiscount %f%%", Number(buybackDiscount) / 100);
                    const { owner, exactOutSwapperV2, usdc, weth, mockSwap, mockSwapRouter, initialUSDCPrice, priceDenominator, publicClient } = await loadFixture(deployPoolsAndRouterMockEnvironment);
                
                    const expectedAmountOut = parseEther("0.9");
                    const amountInMax = parseUnits("2500", 6);

                    await exactOutSwapperV2.write.setAuthorizedSwapCaller([owner.account.address, true], { account: owner.account });
                    if (buybackDiscount !== 100n) {
                        await exactOutSwapperV2.write.setBuybackDiscountBips([usdc.address, weth.address, buybackDiscount], { account: owner.account });
                    }
                    await usdc.write.approve([exactOutSwapperV2.address, amountInMax], { account: owner.account });

                    const usdcBalancesBefore = await takeBalanceSnapshot(publicClient, usdc.address, owner.account.address, exactOutSwapperV2.address);
                    const wethBalancesBefore = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, exactOutSwapperV2.address);

                    const swapCalldata = getRouterSwapFunctionCallData(mockSwapRouter.address, usdc.address, weth.address, amountInMax, exactOutSwapperV2.address);

                    await exactOutSwapperV2.write.swapExactOut(
                        [usdc.address, weth.address, amountInMax, expectedAmountOut, swapCalldata.to, swapCalldata.data],
                        { account: owner.account }
                    )

                    const usdcBalancesAfter = await takeBalanceSnapshot(publicClient, usdc.address, owner.account.address, exactOutSwapperV2.address);
                    const wethBalancesAfter = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, exactOutSwapperV2.address);

                    const buybackEvents = await exactOutSwapperV2.getEvents.ExcessTokensPurchased();
                    expect(buybackEvents).to.have.lengthOf(1);
                    const buybackEvent = buybackEvents[0];
                    const swapEvents = await mockSwap.getEvents.Swap();
                    expect(swapEvents).to.have.lengthOf(1);
                    const swapEvent = swapEvents[0];

                    expect(swapEvent.args.amountIn).to.equal(amountInMax, "Swap amount in should be equal to amountInMax");
                    expect(swapEvent.args.amountOut).to.equal(
                        amountInMax * initialUSDCPrice / priceDenominator * (10n ** 12n), 
                        "Swap amount out should be equal to amountIn * price"
                    );
                    expect(buybackEvent.args.excessAmount).to.equal(
                        amountInMax * initialUSDCPrice / priceDenominator * (10n ** 12n) - expectedAmountOut, 
                        "Excess amount should be equal to amountInMax * price - expectedAmountOut"
                    );
                    expect(buybackEvent.args.buybackAmount).to.equal(
                        buybackEvent.args.excessAmount! * amountInMax * (10000n - buybackDiscount) / (10000n * swapEvent.args.amountOut!),
                        "Buyback amount should be equal to excess amount * swap price * (1 - buyback discount)"
                    );
                    
                    expect(wethBalancesAfter.get(owner.account.address)).to.equal(
                        wethBalancesBefore.get(owner.account.address) + expectedAmountOut, 
                        "User should have received exact WETH to their account"
                    );
                    expect(usdcBalancesAfter.get(owner.account.address)).to.equal(
                        usdcBalancesBefore.get(owner.account.address) - amountInMax + buybackEvent.args.buybackAmount!, 
                        "User should have spent USDC from their account"
                    );
                }
            });
        });
    });

    describe("Validations", function () {
        it("Must receive at least amountOut from swap", async function () {
            const { owner, exactOutSwapperV2, weth, uPPG, mockSwapRouter } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            const expectedAmountOut = parseEther("1");
            const amountInMax = parseEther("0.9");

            await exactOutSwapperV2.write.setAuthorizedSwapCaller([owner.account.address, true], { account: owner.account });
            await weth.write.approve([exactOutSwapperV2.address, amountInMax], { account: owner.account });

            const swapCalldata = getRouterSwapFunctionCallData(mockSwapRouter.address, weth.address, uPPG.address, amountInMax, exactOutSwapperV2.address);

            await expect(exactOutSwapperV2.write.swapExactOut(
                [weth.address, uPPG.address, amountInMax, expectedAmountOut, swapCalldata.to, swapCalldata.data],
                { account: owner.account }
            )).to.be.rejectedWith("InsufficientAmountOutReceived");
        });

        it("Must have enough balance to buyback", async function () {
            const { owner, exactOutSwapperV2, weth, uPPG, mockSwapRouter } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            const expectedAmountOut = parseEther("0.9");
            const amountInMax = parseEther("1");

            await exactOutSwapperV2.write.setAuthorizedSwapCaller([owner.account.address, true], { account: owner.account });
            await weth.write.approve([exactOutSwapperV2.address, amountInMax], { account: owner.account });

            const swapperWethBalance = await weth.read.balanceOf([exactOutSwapperV2.address]);
            await exactOutSwapperV2.write.withdrawTokens([weth.address, swapperWethBalance], { account: owner.account });

            const swapCalldata = getRouterSwapFunctionCallData(mockSwapRouter.address, weth.address, uPPG.address, amountInMax, exactOutSwapperV2.address);

            await expect(exactOutSwapperV2.write.swapExactOut(
                [weth.address, uPPG.address, amountInMax, expectedAmountOut, swapCalldata.to, swapCalldata.data],
                { account: owner.account }
            )).to.be.rejectedWith("InsufficientTokenBalance");
        });

        it("Only authorized callers can call swapExactOut", async function () {
            const { user1, exactOutSwapperV2, weth, uPPG, mockSwapRouter } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            await expect(exactOutSwapperV2.write.swapExactOut(
                [weth.address, uPPG.address, 1000n, 1n, mockSwapRouter.address, "0x"], 
                { account: user1.account }
            )).to.be.rejectedWith("UnauthorizedCaller");
        });

        it("Only admin can call setBuybackDiscountBips", async function () {
            const { user1, exactOutSwapperV2, uPPG, weth } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            await expect(exactOutSwapperV2.write.setBuybackDiscountBips([uPPG.address, weth.address, 10n], { account: user1.account })).to.be.rejectedWith("AccessManagerUnauthorizedAccount");
        });

        it("Only admin can call setAuthorizedSwapCaller", async function () {
            const { user1, exactOutSwapperV2, weth } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            await expect(exactOutSwapperV2.write.setAuthorizedSwapCaller(
                [weth.address, true],
                { account: user1.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");
        });

        it("Only admin can call sellExistingTokens", async function () {
            const { user1, exactOutSwapperV2, weth, mockSwapRouter } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            await expect(exactOutSwapperV2.write.sellExistingTokens(
                [weth.address, 1000n, mockSwapRouter.address, "0x"], 
                { account: user1.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");
        });

        it("Only admin can call withdrawTokens", async function () {
            const { user1, owner, exactOutSwapperV2, weth } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            await expect(exactOutSwapperV2.write.withdrawTokens(
                [weth.address, 1000n], 
                { account: user1.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");

            await expect(exactOutSwapperV2.write.withdrawTokens(
                [weth.address, 1000n], { account: owner.account }
            )).to.be.fulfilled;
        });

        it("Only admin can upgrade", async function () {
            const { user1, owner, exactOutSwapperV2, weth } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            const exactOutSwapperV2Impl = getAddress(await hre.upgrades.erc1967.getImplementationAddress(exactOutSwapperV2.address));

            await expect(exactOutSwapperV2.write.upgradeToAndCall(
                [exactOutSwapperV2Impl, "0x"], { account: user1.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");

            await expect(exactOutSwapperV2.write.upgradeToAndCall(
                [exactOutSwapperV2Impl, "0x"], { account: owner.account }
            )).to.be.fulfilled;
        });

        it("Cannot set buyback discount for identical tokens", async function () {
            const { owner, exactOutSwapperV2, weth } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            await expect(exactOutSwapperV2.write.setBuybackDiscountBips(
                [weth.address, weth.address, 10n], { account: owner.account }
            )).to.be.rejectedWith("IdenticalAddresses");
        });

        it("Cannot set buyback discount for zero address", async function () {
            const { owner, exactOutSwapperV2, weth } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            await expect(exactOutSwapperV2.write.setBuybackDiscountBips(
                [zeroAddress, weth.address, 10n], { account: owner.account }
            )).to.be.rejectedWith("ZeroAddress");
        });

        it("Cannot reinitialize", async function () {
            const { owner, exactOutSwapperV2, weth } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            await expect(exactOutSwapperV2.write.initialize(
                [owner.account.address, [weth.address]], { account: owner.account }
            )).to.be.rejectedWith("InvalidInitialization");
        });
    });
});