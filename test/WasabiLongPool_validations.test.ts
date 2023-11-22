import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseEther, zeroAddress, getAddress } from "viem";
import { ClosePositionRequest, FunctionCallData, OpenPositionRequest, getValueWithoutFee } from "./utils/PerpStructUtils";
import { signClosePositionRequest, signOpenPositionRequest } from "./utils/SigningUtils";
import { deployAddressProvider2, deployLongPoolMockEnvironment, deployWasabiLongPool } from "./fixtures";
import { getApproveAndSwapFunctionCallData, getRevertingSwapFunctionCallData } from "./utils/SwapUtils";

describe("WasabiLongPool - Validations Test", function () {
    describe("Deployment", function () {
        it("Should set the right address provider", async function () {
            const { wasabiLongPool, addressProvider } = await loadFixture(deployWasabiLongPool);
            expect(await wasabiLongPool.read.addressProvider()).to.equal(getAddress(addressProvider.address));
        });

        it("Should set the right owner", async function () {
            const { wasabiLongPool, owner } = await loadFixture(deployWasabiLongPool);
            expect(await wasabiLongPool.read.owner()).to.equal(getAddress(owner.account.address));
        });

        it("OnlyOwner can set address provider", async function () {
            const { wasabiLongPool, user1, owner } = await loadFixture(deployLongPoolMockEnvironment);
            const { addressProvider: newAddressProvider } = await loadFixture(deployAddressProvider2);

            await expect(wasabiLongPool.write.setAddressProvider([newAddressProvider.address], {account: user1.account }))
                .to.be.rejectedWith(`OwnableUnauthorizedAccount("${getAddress(user1.account.address)}")`, "Only owner can set address provider");
    
            await wasabiLongPool.write.setAddressProvider([newAddressProvider.address], {account: owner.account });
            expect(await wasabiLongPool.read.addressProvider()).to.equal(getAddress(newAddressProvider.address));
        });
    });

    describe("Open Position Validations", function () {
        it("InvalidSignature", async function () {
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

        it("PositionAlreadyTaken", async function () {
            const { wasabiLongPool, user1, openPositionRequest, downPayment, signature } = await loadFixture(deployLongPoolMockEnvironment);

            await wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account });

            await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("PositionAlreadyTaken", "Cannot open position if position is already taken");
        });

        it("SwapFunctionNeeded", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, downPayment, contractName } = await loadFixture(deployLongPoolMockEnvironment);

            const swaplessRequest: OpenPositionRequest = { ...openPositionRequest, functionCallDataList: [] };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, swaplessRequest);

            await expect(wasabiLongPool.write.openPosition([swaplessRequest, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("SwapFunctionNeeded", "Cannot open positions without swap functions");
        });

        it("OrderExpired", async function () {
            const { publicClient, wasabiLongPool, user1, owner, openPositionRequest, downPayment, contractName } = await loadFixture(deployLongPoolMockEnvironment);

            const expiration = await publicClient.getBlock().then(b => b.timestamp);
            const expiredRequest: OpenPositionRequest = { ...openPositionRequest, expiration: expiration - 1n };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, expiredRequest);

            await expect(wasabiLongPool.write.openPosition([expiredRequest, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("OrderExpired", "Cannot open positions with expired orders");
        });

        it("InvalidCurrency", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, downPayment, contractName } = await loadFixture(deployLongPoolMockEnvironment);

            const request: OpenPositionRequest = { ...openPositionRequest, currency: user1.account.address };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("InvalidCurrency", "Cannot open positions with non ETH currency");
        });

        it("InvalidTargetCurrency", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, downPayment, contractName } = await loadFixture(deployLongPoolMockEnvironment);

            const request: OpenPositionRequest = { ...openPositionRequest, targetCurrency: zeroAddress };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("InvalidTargetCurrency", "Cannot open positions with ETH target currency");
        });

        it("InsufficientAmountProvided", async function () {
            const { wasabiLongPool, user1, openPositionRequest, downPayment, signature } = await loadFixture(deployLongPoolMockEnvironment);

            await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment - 1n, account: user1.account }))
                .to.be.rejectedWith("InsufficientAmountProvided", "Need to provide the downpayment exactly");
        });

        it("PrincipalTooHigh", async function () {
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

        it("InsufficientAvailablePrincipal", async function () {
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
                functionCallDataList 
            };

            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, request);
            await expect(wasabiLongPool.write.openPosition([request, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("InsufficientAvailablePrincipal", "Cannot open positions with insufficient available principal");
        });

        it("InsufficientCollateralReceived", async function () {
            const { wasabiLongPool, user1, openPositionRequest, downPayment, signature, mockSwap, initialPrice } = await loadFixture(deployLongPoolMockEnvironment);

            // Example: Price spiked to 2x the initial price right before the position is opened
            await mockSwap.write.setPrice([openPositionRequest.targetCurrency, openPositionRequest.currency, initialPrice * 2n]);

            await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("InsufficientCollateralReceived", "Position cannot be opened if collateral received is insufficient");
        });

        it("SwapReverted", async function () {
            const { wasabiLongPool, user1, openPositionRequest, downPayment, owner, contractName, mockSwap } = await loadFixture(deployLongPoolMockEnvironment);

            const request: OpenPositionRequest = {
                ...openPositionRequest,
                functionCallDataList: [
                    ...openPositionRequest.functionCallDataList,
                    getRevertingSwapFunctionCallData(mockSwap.address),
                ]
            };
            const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: downPayment, account: user1.account }))
                .to.be.rejectedWith("SwapReverted", "Position cannot be opened if at least one swap function reverts");
        });
    });

    describe("Close Position Validations", function () {
        it("SenderNotTrader", async function () {
            const { sendDefaultOpenPositionRequest, createClosePositionOrder, owner, user1, user2, wasabiLongPool } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();
            const { request, signature } = await createClosePositionOrder({position});
            
            await expect(wasabiLongPool.write.closePosition([request, signature], { account: user2.account }))
                .to.be.rejectedWith("SenderNotTrader", "Only the position owner can close the position");
            await expect(wasabiLongPool.write.closePosition([request, signature], { account: owner.account }))
                .to.be.rejectedWith("SenderNotTrader", "Only the position owner can close the position");
            await wasabiLongPool.write.closePosition([request, signature], { account: user1.account });
        });

        it("InvalidPosition", async function () {
            const { sendDefaultOpenPositionRequest, createClosePositionOrder, owner, user1, user2, wasabiLongPool } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            // Change the position
            position.collateralAmount = position.collateralAmount * 2n;
            const { request, signature } = await createClosePositionOrder({position});
            
            await expect(wasabiLongPool.write.closePosition([request, signature], { account: user1.account }))
                .to.be.rejectedWith("InvalidPosition", "Only valid positions can be closed");
        });

        it("SwapReverted", async function () {
            const { sendDefaultOpenPositionRequest, mockSwap, contractName, owner, user1, wasabiLongPool } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            const request: ClosePositionRequest = {
                expiration: BigInt(await time.latest()) + 300n,
                interest: 0n,
                position,
                functionCallDataList: [
                    ...getApproveAndSwapFunctionCallData(mockSwap.address, position.collateralCurrency, position.currency, position.collateralAmount),
                    getRevertingSwapFunctionCallData(mockSwap.address),
                ],
            };
            const signature = await signClosePositionRequest(owner, contractName, wasabiLongPool.address, request);
            
            await expect(wasabiLongPool.write.closePosition([request, signature], { account: user1.account }))
                .to.be.rejectedWith("SwapReverted", "Position cannot be closed if at least one swap function reverts");
        });

        it("SwapFunctionNeeded", async function () {
            const { sendDefaultOpenPositionRequest, contractName, owner, user1, wasabiLongPool } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            const request: ClosePositionRequest = {
                expiration: BigInt(await time.latest()) + 300n,
                interest: 0n,
                position,
                functionCallDataList: [],
            };
            const signature = await signClosePositionRequest(owner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.closePosition([request, signature], { account: user1.account }))
                .to.be.rejectedWith("SwapFunctionNeeded", "Position cannot be closed if no swap functions are provided");
        });

        it("OrderExpired", async function () {
            const { sendDefaultOpenPositionRequest, createClosePositionOrder, user1, wasabiLongPool } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();
            const { request, signature } = await createClosePositionOrder({
                position,
                expiration: await time.latest() - 1
            });

            await expect(wasabiLongPool.write.closePosition([request, signature], { account: user1.account }))
                .to.be.rejectedWith("OrderExpired", "Position cannot be closed if order is expired");
        });
    });

    describe("Liquidate Position Validations", function () {
        it("OnlyOwner", async function () {
            const { sendDefaultOpenPositionRequest, computeLiquidationPrice, computeMaxInterest, owner, user2, wasabiLongPool, uPPG, mockSwap } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            const interest = await computeMaxInterest(position);
            const liquidationPrice = await computeLiquidationPrice(position);
            await mockSwap.write.setPrice([position.collateralCurrency, position.currency, liquidationPrice]);

            // Liquidate Position
            const functionCallDataList = getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, zeroAddress, position.collateralAmount);

            await expect(wasabiLongPool.write.liquidatePosition([interest, position, functionCallDataList], { account: user2.account }))
                .to.be.rejectedWith(`OwnableUnauthorizedAccount("${getAddress(user2.account.address)}")`, "Only the owner can liquidate");

            await wasabiLongPool.write.liquidatePosition([interest, position, functionCallDataList], { account: owner.account });
        });

        it("LiquidationThresholdNotReached", async function () {
            const { sendDefaultOpenPositionRequest, computeLiquidationPrice, computeMaxInterest, owner, wasabiLongPool, uPPG, mockSwap } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            const interest = await computeMaxInterest(position);
            const liquidationPrice = await computeLiquidationPrice(position);
            await mockSwap.write.setPrice([position.collateralCurrency, position.currency, liquidationPrice + 1n]);

            // Liquidate Position
            const functionCallDataList = getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, zeroAddress, position.collateralAmount);

            await expect(wasabiLongPool.write.liquidatePosition([interest, position, functionCallDataList], { account: owner.account }))
                .to.be.rejectedWith("LiquidationThresholdNotReached", "Position cannot be liquidated if liquidation threshold is not reached");

            await mockSwap.write.setPrice([position.collateralCurrency, position.currency, liquidationPrice]);
            await wasabiLongPool.write.liquidatePosition([interest, position, functionCallDataList], { account: owner.account });
        });
    });
});