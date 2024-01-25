import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseEther, getAddress } from "viem";
import { ClosePositionRequest, FunctionCallData, OpenPositionRequest, getFee, getValueWithoutFee } from "./utils/PerpStructUtils";
import { signClosePositionRequest, signOpenPositionRequest } from "./utils/SigningUtils";
import { deployAddressProvider2, deployLongPoolMockEnvironment, deployMaliciousVault, deployShortPoolMockEnvironment, deployVault, deployWasabiLongPool, deployWasabiShortPool } from "./fixtures";
import { getApproveAndSwapFunctionCallData, getRevertingSwapFunctionCallData } from "./utils/SwapUtils";
import { getBalance } from "./utils/StateUtils";

describe("WasabiLongPool - Validations Test", function () {
    describe("Deployment", function () {
        it("Should set the right address provider", async function () {
            const { wasabiShortPool, addressProvider } = await loadFixture(deployWasabiShortPool);
            expect(await wasabiShortPool.read.addressProvider()).to.equal(getAddress(addressProvider.address));
        });
    });

    describe("Open Position Validations", function () {
        it("PrincipalTooHigh", async function () {
            const { wasabiShortPool, uPPG, user1, totalAmountIn, maxLeverage, owner, tradeFeeValue, contractName, openPositionRequest, initialPrice, priceDenominator } = await loadFixture(deployShortPoolMockEnvironment);
    
            const leverage = maxLeverage / 100n + 1n;
            const fee = getFee(totalAmountIn * (leverage + 2n), tradeFeeValue);
            const downPayment = totalAmountIn - fee;
        
            const swappedAmount = downPayment * initialPrice / priceDenominator;
            const principal = swappedAmount * (leverage + 1n);
            
            const request: OpenPositionRequest = {
                ...openPositionRequest,
                principal
            };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiShortPool.address, request);
    
            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("PrincipalTooHigh", "Principal is too high");
        });
    });

    describe("Close Position Validations", function () {
        it("InvalidInterestAmount", async function () {
            const { computeMaxInterest, createClosePositionRequest, signClosePositionRequest, createClosePositionOrder, wasabiShortPool, uPPG, user1, totalAmountIn, maxLeverage, owner, tradeFeeValue, contractName, openPositionRequest, initialPrice, priceDenominator, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

            const { position } = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Close Position
            const interest = (await computeMaxInterest(position)) / 2n;
            const request = await createClosePositionRequest({ position, interest });
            request.interest = interest * 105n / 100n; // Change interest to be invalid
            const signature = await signClosePositionRequest(owner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.closePosition([true, request, signature], { account: user1.account }))
                .to.be.rejectedWith("InvalidInterestAmount", "Interest amount is invalid");
        });
    });
});