import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseEther, getAddress, encodeFunctionData, parseUnits } from "viem";
import { ClosePositionRequest, FunctionCallData, OpenPositionRequest, getFee, getValueWithoutFee, getEmptyPosition, PayoutType } from "./utils/PerpStructUtils";
import { signClosePositionRequest, signOpenPositionRequest } from "./utils/SigningUtils";
import { deployAddressProvider2, deployLongPoolMockEnvironment, deployVault, deployWasabiLongPool } from "./fixtures";
import { getApproveAndSwapFunctionCallData, getApproveAndSwapFunctionCallDataExact, getRevertingSwapFunctionCallData } from "./utils/SwapUtils";
import { getBalance } from "./utils/StateUtils";
import { LIQUIDATOR_ROLE } from "./utils/constants";

describe("WasabiLongPool - Validations Test", function () {
    describe("Deployment", function () {
        it("Should set the right address provider", async function () {
            const { wasabiLongPool, addressProvider } = await loadFixture(deployWasabiLongPool);
            expect(await wasabiLongPool.read.addressProvider()).to.equal(getAddress(addressProvider.address));
        });

        it("Should set the right owner", async function () {
            const { wasabiLongPool, manager } = await loadFixture(deployWasabiLongPool);
            expect(await wasabiLongPool.read.owner()).to.equal(manager.address);
        });
    });

    describe("Open Position Validations", function () {
        it("InvalidSignature", async function () {
            const { wasabiLongPool, user1, owner, orderSigner, openPositionRequest, totalAmountIn, contractName, signature, debtController } = await loadFixture(deployLongPoolMockEnvironment);

            const invalidSignerSignature = await signOpenPositionRequest(user1, contractName, wasabiLongPool.address, openPositionRequest);
            await expect(wasabiLongPool.write.openPosition([openPositionRequest, invalidSignerSignature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidSignature", "Only the owner can sign");

            const invalidContractSignature = await signOpenPositionRequest(orderSigner, contractName, debtController.address, openPositionRequest);
            await expect(wasabiLongPool.write.openPosition([openPositionRequest, invalidContractSignature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidSignature", "Domain needs to be correct");

            const differentRequest: OpenPositionRequest = { ...openPositionRequest, id: 100n };
            await expect(wasabiLongPool.write.openPosition([differentRequest, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidSignature", "Cannot use signature for other requests");
        });

        it("PositionAlreadyTaken", async function () {
            const { wasabiLongPool, user1, openPositionRequest, signature, totalAmountIn } = await loadFixture(deployLongPoolMockEnvironment);

            await wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account });

            await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("PositionAlreadyTaken", "Cannot open position if position is already taken");
        });

        it("SwapFunctionNeeded", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, contractName, totalAmountIn, orderSigner } = await loadFixture(deployLongPoolMockEnvironment);

            const swaplessRequest: OpenPositionRequest = { ...openPositionRequest, functionCallDataList: [] };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, swaplessRequest);

            await expect(wasabiLongPool.write.openPosition([swaplessRequest, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("SwapFunctionNeeded", "Cannot open positions without swap functions");
        });

        it("Cannot Reuse Signature", async function () {
            const { wasabiLongPool, createSignedClosePositionRequest, sendDefaultOpenPositionRequest, user1 } = await loadFixture(deployLongPoolMockEnvironment);

            const {position} = await sendDefaultOpenPositionRequest();

            const {request, signature } = await createSignedClosePositionRequest({ position });

            await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            await expect(sendDefaultOpenPositionRequest())
                .to.be.rejectedWith("PositionAlreadyTaken", "Cannot open position if position is it was opened before");

            const positionHash = await wasabiLongPool.read.positions([position.id]);
            expect(positionHash).to.equal(1n);
        });

        it("OrderExpired", async function () {
            const { publicClient, wasabiLongPool, user1, owner, openPositionRequest, totalAmountIn, contractName, orderSigner } = await loadFixture(deployLongPoolMockEnvironment);

            const expiration = await publicClient.getBlock().then(b => b.timestamp);
            const expiredRequest: OpenPositionRequest = { ...openPositionRequest, expiration: expiration - 1n };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, expiredRequest);

            await expect(wasabiLongPool.write.openPosition([expiredRequest, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("OrderExpired", "Cannot open positions with expired orders");
        });

        it("InvalidCurrency", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, totalAmountIn, contractName, orderSigner } = await loadFixture(deployLongPoolMockEnvironment);

            const request: OpenPositionRequest = { ...openPositionRequest, currency: user1.account.address };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidCurrency", "Cannot open positions with non ETH currency");
        });

        it("InvalidTargetCurrency", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, totalAmountIn, contractName, wethAddress, orderSigner } = await loadFixture(deployLongPoolMockEnvironment);

            const request: OpenPositionRequest = { ...openPositionRequest, targetCurrency: wethAddress };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidTargetCurrency", "Cannot open positions with ETH target currency");
        });

        it("InsufficientAmountProvided", async function () {
            const { wasabiLongPool, user1, openPositionRequest, totalAmountIn, signature } = await loadFixture(deployLongPoolMockEnvironment);

            await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn - 1n, account: user1.account }))
                .to.be.rejectedWith("InsufficientAmountProvided", "Need to provide the totalAmountIn exactly");
        });

        it("PrincipalTooHigh", async function () {
            const { wasabiLongPool, user1, totalAmountIn, maxLeverage, owner, tradeFeeValue, contractName, openPositionRequest, orderSigner } = await loadFixture(deployLongPoolMockEnvironment);

            const principal = getValueWithoutFee(totalAmountIn, tradeFeeValue) * maxLeverage + 1n;
            const request: OpenPositionRequest = {
                ...openPositionRequest,
                principal
            };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("PrincipalTooHigh", "Principal is too high");
        });

        it("InsufficientAvailablePrincipal", async function () {
            const { wasabiLongPool, vault, user1, orderSigner, owner, tradeFeeValue, contractName, publicClient, mockSwap, uPPG, wethAddress } = await loadFixture(deployLongPoolMockEnvironment);

            const leverage = 4n;
            const availablePrincipalBalance = await getBalance(publicClient, wethAddress, vault.address);
            const totalAmountIn = availablePrincipalBalance / 2n;
            const fee = getFee(totalAmountIn * leverage, tradeFeeValue);
            const downPayment = totalAmountIn - fee;
            const principal = downPayment * (leverage - 1n);
            const functionCallDataList: FunctionCallData[] =
                getApproveAndSwapFunctionCallData(mockSwap.address, wethAddress, uPPG.address, principal + downPayment);
            const request: OpenPositionRequest = {
                id: 1n,
                currency: wethAddress,
                targetCurrency: uPPG.address,
                downPayment,
                principal,
                minTargetAmount: parseEther("3"),
                expiration: BigInt(await time.latest()) + 86400n,
                fee,
                functionCallDataList,
                existingPosition: getEmptyPosition(),
                interestToPay: 0n
            };

            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request);
            await expect(wasabiLongPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InsufficientAvailablePrincipal", "Cannot open positions with insufficient available principal");
        });

        it("InsufficientCollateralReceived", async function () {
            const { wasabiLongPool, user1, openPositionRequest, totalAmountIn, signature, mockSwap, initialPrice } = await loadFixture(deployLongPoolMockEnvironment);

            // Example: Price spiked to 2x the initial price right before the position is opened
            await mockSwap.write.setPrice([openPositionRequest.targetCurrency, openPositionRequest.currency, initialPrice * 2n]);

            await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InsufficientCollateralReceived", "Position cannot be opened if collateral received is insufficient");
        });

        it("SwapReverted", async function () {
            const { wasabiLongPool, user1, openPositionRequest, totalAmountIn, owner, contractName, mockSwap, orderSigner } = await loadFixture(deployLongPoolMockEnvironment);

            const request: OpenPositionRequest = {
                ...openPositionRequest,
                functionCallDataList: [
                    ...openPositionRequest.functionCallDataList,
                    getRevertingSwapFunctionCallData(mockSwap.address),
                ]
            };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("SwapReverted", "Position cannot be opened if at least one swap function reverts");
        });

        it("SenderNotTrader", async function () {
            const { wasabiLongPool, user1, user2, openPositionRequest, totalAmountIn, contractName, orderSigner } = await loadFixture(deployLongPoolMockEnvironment);

            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, openPositionRequest);

            await expect(wasabiLongPool.write.openPositionFor([openPositionRequest, signature, user1.account.address], { value: totalAmountIn, account: user2.account }))
                .to.be.rejectedWith("SenderNotTrader", "Cannot open positions on behalf of other traders");
        }); 

        it("InvalidInterestAmount", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, totalAmountIn, contractName, orderSigner } = await loadFixture(deployLongPoolMockEnvironment);

            const request: OpenPositionRequest = { ...openPositionRequest, interestToPay: 1n };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidInterestAmount", "Cannot pay interest when opening a new position");
        });

        it("InvalidPosition", async function () {
            const { wasabiLongPool, user1, owner, openPositionRequest, totalAmountIn, contractName, orderSigner } = await loadFixture(deployLongPoolMockEnvironment);

            const existingPosition = getEmptyPosition();
            let request: OpenPositionRequest = { ...openPositionRequest, existingPosition: { ...existingPosition, downPayment: 1n} };
            let signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidPosition", "Existing position must be empty when opening a new position");

            request = { ...openPositionRequest, existingPosition: { ...existingPosition, principal: 1n} };
            signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidPosition", "Existing position must be empty when opening a new position");
            
            request = { ...openPositionRequest, existingPosition: { ...existingPosition, collateralAmount: 1n} };
            signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidPosition", "Existing position must be empty when opening a new position");
            
            request = { ...openPositionRequest, existingPosition: { ...existingPosition, feesToBePaid: 1n} };
            signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidPosition", "Existing position must be empty when opening a new position");
        });
    });

    describe("Edit Position Validations", function () {
        describe("Increase Position", function () {
            it("InvalidPosition - request.id != request.existingPosition.id", async function () {
                const { wasabiLongPool, mockSwap, wethAddress, uPPG, user1, totalAmountIn, totalSize, initialPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest, computeMaxInterest } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const interest = await computeMaxInterest(position);
                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, wethAddress, uPPG.address, totalSize);
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id + 1n, // Incorrect ID
                    currency: position.currency,
                    targetCurrency: position.collateralCurrency,
                    downPayment: position.downPayment,
                    principal: position.principal,
                    minTargetAmount: totalSize * initialPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    interestToPay: interest
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, openPositionRequest);

                await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InvalidPosition", "Cannot increase position with different position ID");
            });

            it("InvalidPosition - stored hash != request.existingPosition.hash", async function () {
                const { wasabiLongPool, mockSwap, wethAddress, uPPG, user1, totalAmountIn, totalSize, initialPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest, computeMaxInterest } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const interest = await computeMaxInterest(position);
                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, wethAddress, uPPG.address, totalSize);
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id,
                    currency: position.currency,
                    targetCurrency: position.collateralCurrency,
                    downPayment: position.downPayment,
                    principal: position.principal,
                    minTargetAmount: totalSize * initialPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    interestToPay: interest
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, openPositionRequest);

                // Increase Position
                await wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account });

                await time.increase(86400n); // 1 day later

                // Try to reuse the same request
                await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InvalidPosition", "Cannot reuse the same request to increase position twice");
            });

            it("InvalidCurrency", async function () {
                const { wasabiLongPool, mockSwap, wethAddress, uPPG, user1, totalAmountIn, totalSize, initialPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest, computeMaxInterest } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const interest = await computeMaxInterest(position);
                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, wethAddress, uPPG.address, totalSize);
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id,
                    currency: position.collateralCurrency, // Incorrect currency
                    targetCurrency: position.collateralCurrency,
                    downPayment: position.downPayment,
                    principal: position.principal,
                    minTargetAmount: totalSize * initialPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    interestToPay: interest
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, openPositionRequest);

                await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InvalidCurrency", "request.currency must match request.existingPosition.currency");
            });

            it("InvalidTargetCurrency", async function () {
                const { wasabiLongPool, mockSwap, wethAddress, uPPG, user1, totalAmountIn, totalSize, initialPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest, computeMaxInterest } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const interest = await computeMaxInterest(position);
                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, wethAddress, uPPG.address, totalSize);
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id,
                    currency: position.currency,
                    targetCurrency: position.currency, // Incorrect target currency
                    downPayment: position.downPayment,
                    principal: position.principal,
                    minTargetAmount: totalSize * initialPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    interestToPay: interest
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, openPositionRequest);

                await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InvalidTargetCurrency", "request.targetCurrency must match request.existingPosition.collateralCurrency");
            });

            it("InvalidInterestAmount", async function () {
                const { wasabiLongPool, mockSwap, wethAddress, uPPG, user1, totalAmountIn, totalSize, initialPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, wethAddress, uPPG.address, totalSize);
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id,
                    currency: position.currency,
                    targetCurrency: position.collateralCurrency,
                    downPayment: position.downPayment,
                    principal: position.principal,
                    minTargetAmount: totalSize * initialPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    interestToPay: 0n // Incorrect interest
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, openPositionRequest);

                await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InvalidInterestAmount", "Must not pay interest when adding collateral");
            });

            it("SenderNotTrader", async function () {
                const { wasabiLongPool, mockSwap, wethAddress, uPPG, user1, user2, totalAmountIn, totalSize, initialPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest, computeMaxInterest } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const interest = await computeMaxInterest(position);
                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, wethAddress, uPPG.address, totalSize);
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id,
                    currency: position.currency,
                    targetCurrency: position.collateralCurrency,
                    downPayment: position.downPayment,
                    principal: position.principal,
                    minTargetAmount: totalSize * initialPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    interestToPay: interest
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, openPositionRequest);

                await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user2.account }))
                    .to.be.rejectedWith("SenderNotTrader", "Cannot increase position on behalf of other traders");
            });
        });

        describe("Add Collateral", function () {
            it("InvalidInterestAmount", async function () {
                const { wasabiLongPool, mockSwap, wethAddress, uPPG, user1, totalAmountIn, initialPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest, computeMaxInterest } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const interest = await computeMaxInterest(position);
                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, wethAddress, uPPG.address, position.downPayment);
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id,
                    currency: position.currency,
                    targetCurrency: position.collateralCurrency,
                    downPayment: position.downPayment,
                    principal: 0n,
                    minTargetAmount: position.downPayment * initialPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    interestToPay: interest // Incorrect interest
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, openPositionRequest);

                await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InvalidInterestAmount", "Must pay interest when increasing position");
            });

            it("InsufficientPrincipalUsed", async function () {
                const { wasabiLongPool, mockSwap, wethAddress, uPPG, usdc, user1, totalAmountIn, initialPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployLongPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const usdcAmount = parseUnits("2500", 6);
                await usdc.write.mint([wasabiLongPool.address, usdcAmount]); // Mint USDC to the pool
                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, usdc.address, uPPG.address, usdcAmount); // Incorrect tokenIn
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id,
                    currency: position.currency,
                    targetCurrency: position.collateralCurrency,
                    downPayment: position.downPayment,
                    principal: 0n,
                    minTargetAmount: position.downPayment * initialPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    interestToPay: 0n
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, openPositionRequest);

                await expect(wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InsufficientPrincipalUsed", "Must use same currecy as the existing position when swapping for more collateral");
            });
        });
    });

    describe("Close Position Validations", function () {
        it("SenderNotTrader", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, owner, user1, user2, wasabiLongPool } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();
            const { request, signature } = await createSignedClosePositionRequest({position});
            
            await expect(wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user2.account }))
                .to.be.rejectedWith("SenderNotTrader", "Only the position owner can close the position");
            await expect(wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: owner.account }))
                .to.be.rejectedWith("SenderNotTrader", "Only the position owner can close the position");
            await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });
        });

        it("Liquidator can close", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, liquidator, wasabiLongPool } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();
            const { request, signature } = await createSignedClosePositionRequest({position});
            
            await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: liquidator.account });
        });

        it("InvalidPosition", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, owner, user1, user2, wasabiLongPool } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            // Change the position
            position.collateralAmount = position.collateralAmount * 2n;
            const { request, signature } = await createSignedClosePositionRequest({position});
            
            await expect(wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                .to.be.rejectedWith("InvalidPosition", "Only valid positions can be closed");
        });

        it("SwapReverted", async function () {
            const { sendDefaultOpenPositionRequest, mockSwap, contractName, owner, user1, wasabiLongPool, orderSigner } = await loadFixture(deployLongPoolMockEnvironment);
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
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiLongPool.address, request);
            
            await expect(wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                .to.be.rejectedWith("SwapReverted", "Position cannot be closed if at least one swap function reverts");
        });

        it("SwapFunctionNeeded", async function () {
            const { sendDefaultOpenPositionRequest, contractName, owner, user1, wasabiLongPool, orderSigner } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            const request: ClosePositionRequest = {
                expiration: BigInt(await time.latest()) + 300n,
                interest: 0n,
                position,
                functionCallDataList: [],
            };
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                .to.be.rejectedWith("SwapFunctionNeeded", "Position cannot be closed if no swap functions are provided");
        });

        it("OrderExpired", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, user1, wasabiLongPool } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();
            const { request, signature } = await createSignedClosePositionRequest({
                position,
                expiration: await time.latest() - 1
            });

            await expect(wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                .to.be.rejectedWith("OrderExpired", "Position cannot be closed if order is expired");
        });

        it("TooMuchCollateralSpent", async function () {
            const { sendDefaultOpenPositionRequest, mockSwap, user1, wasabiLongPool, orderSigner, contractName } = await loadFixture(deployLongPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            // Open extra position to get more collateral in to the pool
            await sendDefaultOpenPositionRequest(2n);

            const collateralToSpend = position.collateralAmount + 1n;
            const request: ClosePositionRequest = {
                expiration: BigInt(await time.latest()) + 300n,
                interest: 0n,
                position,
                functionCallDataList: getApproveAndSwapFunctionCallData(mockSwap.address, position.collateralCurrency, position.currency, collateralToSpend),
            };
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                .to.be.rejectedWith("TooMuchCollateralSpent", "Cannot spend more collateral than the position has");
        });

        it("InsufficientPrincipalRepaid", async function () {
            const { sendDefaultOpenPositionRequest, orderSigner, user1, contractName, wasabiLongPool, mockSwap } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            // Craft a ClosePositionRequest with a malicious swap function call using MockSwap.swapExact
            const request: ClosePositionRequest = {
                expiration: BigInt(await time.latest()) + 300n,
                interest: 0n,
                position,
                functionCallDataList: getApproveAndSwapFunctionCallDataExact(mockSwap.address, position.collateralCurrency, position.currency, position.collateralAmount, 1n), // bad amountOut
            };
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiLongPool.address, request);

            await expect(wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                .to.be.rejectedWith("InsufficientPrincipalRepaid");
        })
    });

    describe("Liquidate Position Validations", function () {
        it("OnlyLiquidator", async function () {
            const { sendDefaultOpenPositionRequest, computeLiquidationPrice, computeMaxInterest, liquidator, user2, wasabiLongPool, uPPG, mockSwap, wethAddress } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            const interest = await computeMaxInterest(position);
            const liquidationPrice = await computeLiquidationPrice(position);
            await mockSwap.write.setPrice([position.collateralCurrency, position.currency, liquidationPrice]);

            // Liquidate Position
            const functionCallDataList = getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, position.collateralAmount);

            await expect(wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: user2.account }))
                .to.be.rejectedWith(`AccessManagerUnauthorizedAccount("${getAddress(user2.account.address)}", ${LIQUIDATOR_ROLE})`, "Only the liquidator can liquidate");

            await wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: liquidator.account });
        });

        it("LiquidationThresholdNotReached", async function () {
            const { sendDefaultOpenPositionRequest, computeLiquidationPrice, computeMaxInterest, liquidator, wasabiLongPool, uPPG, mockSwap, wethAddress } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            const interest = await computeMaxInterest(position);
            const liquidationPrice = await computeLiquidationPrice(position);
            await mockSwap.write.setPrice([position.collateralCurrency, position.currency, liquidationPrice + 2n]);

            // Liquidate Position
            const functionCallDataList = getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, position.collateralAmount);

            await expect(wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: liquidator.account }))
                .to.be.rejectedWith("LiquidationThresholdNotReached", "Position cannot be liquidated if liquidation threshold is not reached");

            await mockSwap.write.setPrice([position.collateralCurrency, position.currency, liquidationPrice]);
            await wasabiLongPool.write.liquidatePosition([PayoutType.UNWRAPPED, interest, position, functionCallDataList], { account: liquidator.account });
        });
    });

    describe("Claim Position", function () {
        it("Not enough supplied", async function () {
            const { sendDefaultOpenPositionRequest, wasabiLongPool, user1 } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Claim Position
            const amountToPay = position.principal; // not paying interest + closeFee;

            await expect(wasabiLongPool.write.claimPosition([position], { account: user1.account, value: amountToPay }))
                .to.be.rejectedWith("InsufficientAmountProvided", "Cannot claim position if not enough supplied");
        });

        it("Incorrect trader", async function () {
            const { sendDefaultOpenPositionRequest, wasabiLongPool, user2 } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Claim Position
            const amountToPay = position.principal; // not paying interest + closeFee;

            await expect(wasabiLongPool.write.claimPosition([position], { account: user2.account, value: amountToPay }))
                .to.be.rejectedWith("SenderNotTrader", "Only trader can claim");
        });

        it("Incorrect position", async function () {
            const { sendDefaultOpenPositionRequest, wasabiLongPool, user1 } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            let {position} = await sendDefaultOpenPositionRequest();

            position = {...position, id: position.id + 1n};

            await time.increase(86400n); // 1 day later

            // Claim Position
            const amountToPay = position.principal; // not paying interest + closeFee;

            await expect(wasabiLongPool.write.claimPosition([position], { account: user1.account, value: amountToPay }))
                .to.be.rejectedWith("InvalidPosition", "Only an active correct position can be claimed");
        });

        it("Can't claim twice", async function () {
            const { sendDefaultOpenPositionRequest, wasabiLongPool, user1, computeMaxInterest } = await loadFixture(deployLongPoolMockEnvironment);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Claim Position
            const closeFee = position.feesToBePaid;
            const interest = await computeMaxInterest(position);
            const amountToPay = position.principal + interest + closeFee;

            await wasabiLongPool.write.claimPosition([position], { account: user1.account, value: amountToPay });

            await expect(wasabiLongPool.write.claimPosition([position], { account: user1.account, value: amountToPay }))
                .to.be.rejectedWith("InvalidPosition", "Only an active correct position can be claimed");
        });
    });
});