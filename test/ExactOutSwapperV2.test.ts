import {
    loadFixture,
    time,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { deployPoolsAndRouterMockEnvironment } from "./fixtures";
import { signClosePositionRequest } from "./utils/SigningUtils";
import { takeBalanceSnapshot } from "./utils/StateUtils";
import { getERC20ApproveFunctionCallData, getRouterSwapFunctionCallData, getExactOutSwapperFunctionCallData, getSwapExactlyOutFunctionCallData, getExactOutSwapperV2FunctionCallData } from "./utils/SwapUtils";
import { ClosePositionRequest, FunctionCallData, PayoutType } from "./utils/PerpStructUtils";
import { zeroAddress } from "viem";

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
    });

    describe("Validations", function () {
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

        it("Only admin can call sellExistingTokens", async function () {
            const { user1, exactOutSwapperV2, weth, mockSwapRouter } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            await expect(exactOutSwapperV2.write.sellExistingTokens(
                [weth.address, 1000n, mockSwapRouter.address, "0x"], 
                { account: user1.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");
        });
    });
});