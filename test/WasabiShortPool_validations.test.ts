import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { getAddress } from "viem";
import { ClosePositionRequest, FunctionCallData, OpenPositionRequest, getFee } from "./utils/PerpStructUtils";
import { signClosePositionRequest, signOpenPositionRequest } from "./utils/SigningUtils";
import { deployShortPoolMockEnvironment, deployWasabiPoolsMockEnvironment, deployWasabiShortPool } from "./fixtures";
import { getApproveAndSwapFunctionCallData, getApproveAndSwapFunctionCallDataExact } from "./utils/SwapUtils";

describe("WasabiShortPool - Validations Test", function () {
    describe("Deployment", function () {
        it("Should set the right address provider", async function () {
            const { wasabiShortPool, addressProvider } = await loadFixture(deployWasabiShortPool);
            expect(await wasabiShortPool.read.addressProvider()).to.equal(getAddress(addressProvider.address));
        });

        it("Should set the right owner", async function () {
            const { wasabiShortPool, owner, manager } = await loadFixture(deployWasabiShortPool);
            expect(await wasabiShortPool.read.owner()).to.equal(getAddress(manager.address));
        });
    });

    describe("Open Position Validations", function () {
        it("PrincipalTooHigh", async function () {
            const { wasabiShortPool, orderSigner, user1, totalAmountIn, maxLeverage, mockSwap, uPPG, wethAddress, tradeFeeValue, contractName, openPositionRequest, initialPPGPrice, priceDenominator } = await loadFixture(deployShortPoolMockEnvironment);
    
            const leverage = maxLeverage / 100n + 1n;
            const fee = getFee(totalAmountIn * (leverage + 2n), tradeFeeValue);
            const downPayment = totalAmountIn - fee;
        
            const swappedAmount = downPayment * initialPPGPrice / priceDenominator;
            const principal = swappedAmount * (leverage + 1n);

            const functionCallDataList: FunctionCallData[] =
                getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principal);
            
            const request: OpenPositionRequest = {
                ...openPositionRequest,
                functionCallDataList,
                principal
            };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);
    
            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("PrincipalTooHigh", "Principal is too high");
        });

        it("PrincipalTooHigh - V2", async function () {
            const { wasabiShortPool, orderSigner, user1, totalAmountIn, maxLeverage, mockSwap, uPPG, wethAddress, tradeFeeValue, shortOpenPositionRequest, initialPPGPrice, priceDenominator, upgradeToV2 } = await loadFixture(deployWasabiPoolsMockEnvironment);

            await upgradeToV2(0n);
    
            const leverage = maxLeverage / 100n + 1n;
            const fee = getFee(totalAmountIn * (leverage + 2n), tradeFeeValue);
            const downPayment = totalAmountIn - fee;
        
            const swappedAmount = downPayment * initialPPGPrice / priceDenominator;
            const principal = swappedAmount * (leverage + 1n);

            const functionCallDataList: FunctionCallData[] =
                getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principal);
            
            const request: OpenPositionRequest = {
                ...shortOpenPositionRequest,
                functionCallDataList,
                principal
            };
            const signature = await signOpenPositionRequest(orderSigner, "WasabiShortPool", wasabiShortPool.address, request);
    
            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("PrincipalTooHigh", "Principal is too high");
        });

        it("ValueDeviatedTooMuch - Principal", async function () {
            const { wasabiShortPool, orderSigner, user1, totalAmountIn, maxLeverage, mockSwap, uPPG, wethAddress, tradeFeeValue, contractName, openPositionRequest, initialPPGPrice, priceDenominator } = await loadFixture(deployShortPoolMockEnvironment);
    
            const principalThatWillBeUsed = openPositionRequest.principal * 103n / 100n;

            const functionCallDataList: FunctionCallData[] =
                getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principalThatWillBeUsed);
            
            const request: OpenPositionRequest = {
                ...openPositionRequest,
                functionCallDataList
            };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);
    
            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("ValueDeviatedTooMuch", "Too much principal used");
        });

        it("Not - ValueDeviatedTooMuch - Principal", async function () {
            const { wasabiShortPool, orderSigner, user1, totalAmountIn, maxLeverage, mockSwap, uPPG, wethAddress, tradeFeeValue, contractName, openPositionRequest, initialPPGPrice, priceDenominator } = await loadFixture(deployShortPoolMockEnvironment);
    
            const principalThatWillBeUsed = openPositionRequest.principal * 1005n / 1000n; // less than 1%

            const functionCallDataList: FunctionCallData[] =
                getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principalThatWillBeUsed);
            
            const request: OpenPositionRequest = {
                ...openPositionRequest,
                functionCallDataList
            };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);
    
            await wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account });
        });
    });

    describe("Close Position Validations", function () {
        it("ValueDeviatedTooMuch - Interest Paid", async function () {
            const { computeMaxInterest, createClosePositionRequest, signClosePositionRequest, createSignedClosePositionRequest, wasabiShortPool, orderSigner, user1, totalAmountIn, maxLeverage, owner, tradeFeeValue, contractName, openPositionRequest, initialPPGPrice, priceDenominator, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

            const { position } = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Close Position
            const interest = (await computeMaxInterest(position)) / 2n;
            const request = await createClosePositionRequest({ position, interest });
            request.interest = interest * 105n / 100n; // Change interest to be invalid
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.closePosition([true, request, signature], { account: user1.account }))
                .to.be.rejectedWith("ValueDeviatedTooMuch", "Interest amount is invalid");
        });

        it("TooMuchCollateralSpent", async function () {
            const { computeMaxInterest, createClosePositionRequest, signClosePositionRequest, createSignedClosePositionRequest, wasabiShortPool, orderSigner, user1, totalAmountIn, maxLeverage, owner, tradeFeeValue, contractName, openPositionRequest, initialPPGPrice, priceDenominator, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

            const { position } = await sendDefaultOpenPositionRequest();

            // Open extra positions to get more collateral in to the pool
            await sendDefaultOpenPositionRequest(2n);
            await sendDefaultOpenPositionRequest(3n);

            await time.increase(8640000n); // lots of time later, so that more collateral is spent to purchase debt (principal + interest) back

            // Close Position
            const interest = (await computeMaxInterest(position)) / 2n;
            const request = await createClosePositionRequest({ position, interest });
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.closePosition([true, request, signature], { account: user1.account }))
                .to.be.rejectedWith("TooMuchCollateralSpent", "Too much collateral");
        });

        it("InsufficientPrincipalRepaid", async function () {
            const { sendDefaultOpenPositionRequest, orderSigner, user1, contractName, wasabiShortPool, mockSwap } = await loadFixture(deployShortPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            // Craft a ClosePositionRequest with a malicious swap function call using MockSwap.swapExact
            const request: ClosePositionRequest = {
                expiration: BigInt(await time.latest()) + 300n,
                interest: 0n,
                position,
                functionCallDataList: getApproveAndSwapFunctionCallDataExact(mockSwap.address, position.collateralCurrency, position.currency, position.collateralAmount, 1n), // bad amountOut
            };
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.closePosition([true, request, signature], { account: user1.account }))
                .to.be.rejectedWith("InsufficientPrincipalRepaid");
        })
    });
});