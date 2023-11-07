import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseEther, zeroAddress, encodeFunctionData } from "viem";
import { FunctionCallData, OpenPositionRequest, Position, getEventPosition, getValueWithoutFee } from "./utils/PerpStructUtils";
import { signOpenPositionRequest } from "./utils/SigningUtils";
import { deployLongPoolMockEnvironment } from "./fixtures";
import { getApproveAndSwapFunctionCallData } from "./utils/SwapUtils";
import { MockSwapAbi } from "./utils/MockSwapAbi";

describe("WasabiLongPool - Validations Test", function () {
    describe("Open Position Validations", function () {
        it("Invalid Signature", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, downPayment, contractName, signature, debtController } = await loadFixture(deployLongPoolMockEnvironment);

            const invalidSignerSignature = await signOpenPositionRequest(user1, contractName, wasabiLongPool.address, openPositionRequest);
            await expect(wasabiLongPool.write.openPosition([openPositionRequest, invalidSignerSignature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("InvalidSignature", "Only the owner can sign");

            const invalidContractSignature = await signOpenPositionRequest(owner, contractName, debtController.address, openPositionRequest);
            await expect(wasabiLongPool.write.openPosition([openPositionRequest, invalidContractSignature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("InvalidSignature", "Domain needs to be correct");

            const differentRequest: OpenPositionRequest = { ...openPositionRequest, id: 100n };
            await expect(wasabiLongPool.write.openPosition([differentRequest, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("InvalidSignature", "Cannot use signature for other requests");
        });

        it("Position Already Taken", async function () {
            const { wasabiLongPool, user1, openPositionRequest, downPayment, contractName, signature } = await loadFixture(deployLongPoolMockEnvironment);

            await wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account });

            await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("PositionAlreadyTaken", "Cannot open position if position is already taken");
        });

        it("Swapless Open Position Request", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, downPayment, contractName } = await loadFixture(deployLongPoolMockEnvironment);

            const swaplessRequest: OpenPositionRequest = { ...openPositionRequest, functionCallDataList: [] };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, swaplessRequest);

            await expect(wasabiLongPool.write.openPosition([swaplessRequest, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("SwapFunctionNeeded", "Cannot open positions without swap functions");
        });

        it("Order Expired", async function () {
            const { publicClient, wasabiLongPool, user1, owner, openPositionRequest, downPayment, contractName } = await loadFixture(deployLongPoolMockEnvironment);

            const expiration = await publicClient.getBlock().then(b => b.timestamp);
            const expiredRequest: OpenPositionRequest = { ...openPositionRequest, expiration: expiration - 1n };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, expiredRequest);

            await expect(wasabiLongPool.write.openPosition([expiredRequest, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("OrderExpired", "Cannot open positions with expired orders");
        });

        it("Invalid Currency", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, downPayment, contractName } = await loadFixture(deployLongPoolMockEnvironment);

            const request: OpenPositionRequest = { ...openPositionRequest, currency: user1.account.address };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("InvalidCurrency", "Cannot open positions with non ETH currency");
        });

        it("Invalid Target Currency", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, downPayment, contractName } = await loadFixture(deployLongPoolMockEnvironment);

            const request: OpenPositionRequest = { ...openPositionRequest, targetCurrency: zeroAddress };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("InvalidTargetCurrency", "Cannot open positions with ETH target currency");
        });

        it("Insufficient Down Payment", async function () {
            const { wasabiLongPool, user1, openPositionRequest, downPayment, signature } = await loadFixture(deployLongPoolMockEnvironment);

            await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment - 1n, account: user1.account }))
                .to.be.rejectedWith("InsufficientAmountProvided", "Need to provide the downpayment exactly");
        });

        it("Principal Too high", async function () {
            const { wasabiLongPool, user1, downPayment, maxLeverage, owner, tradeFeeValue, contractName, openPositionRequest } = await loadFixture(deployLongPoolMockEnvironment);

            const principal = getValueWithoutFee(downPayment, tradeFeeValue) * maxLeverage + 1n;
            const request: OpenPositionRequest = {
                ...openPositionRequest,
                principal
            };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("PrincipalTooHigh", "Principal is too high");
        });

        it("Insufficient Available Principal", async function () {
            const { wasabiLongPool, user1, maxLeverage, owner, tradeFeeValue, contractName, publicClient, mockSwap, uPPG } = await loadFixture(deployLongPoolMockEnvironment);

            const availablePrincipalBalance = await publicClient.getBalance({address: wasabiLongPool.address});
            const downPayment = availablePrincipalBalance / 2n;
            const principal = getValueWithoutFee(downPayment, tradeFeeValue) * 4n;
            const amount = getValueWithoutFee(downPayment, tradeFeeValue) + principal;
            const functionCallDataList: FunctionCallData[] =
                getApproveAndSwapFunctionCallData(mockSwap.address, zeroAddress, uPPG.address, amount);
            const request: OpenPositionRequest = {
                id: 1n,
                currency: zeroAddress,
                targetCurrency: uPPG.address,
                downPayment,
                principal,
                minTargetAmount: parseEther("3"),
                expiration: BigInt(await time.latest()) + 86400n,
                swapPrice: 0n,
                swapPriceDenominator: 0n,
                functionCallDataList 
            };

            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, request);
            await expect(wasabiLongPool.write.openPosition([request, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("InsufficientAvailablePrincipal", "Cannot open positions with insufficient available principal");
        });

        it("Insufficient Collateral Received", async function () {
            const { wasabiLongPool, user1, openPositionRequest, downPayment, signature, mockSwap, initialPrice } = await loadFixture(deployLongPoolMockEnvironment);

            // Example: Price spiked to 2x the initial price right before the position is opened
            await mockSwap.write.setPrice([openPositionRequest.targetCurrency, openPositionRequest.currency, initialPrice * 2n]);

            await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("InsufficientCollateralReceived", "Position cannot be opened if collateral received is insufficient");
        });

        it("Failing Swap Functions", async function () {
            const { wasabiLongPool, user1, openPositionRequest, downPayment, owner, contractName, mockSwap, initialPrice } = await loadFixture(deployLongPoolMockEnvironment);

            const request: OpenPositionRequest = {
                ...openPositionRequest,
                functionCallDataList: [
                    ...openPositionRequest.functionCallDataList,
                    {
                        to: mockSwap.address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: [MockSwapAbi.find(a => a.type === "function" && a.name === "revertingFunction")!],
                            functionName: "revertingFunction",
                        })
                    }
                ]
            };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("SwapReverted", "Position cannot be opened if at least one swap function reverts");
        });
    });
});