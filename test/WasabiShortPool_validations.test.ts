import { time, loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { getAddress, parseEther, parseUnits, zeroAddress } from "viem";
import { ClosePositionRequest, FunctionCallData, OpenPositionRequest, getFee, PayoutType, getEmptyPosition, AddCollateralRequest, RemoveCollateralRequest, OrderType } from "./utils/PerpStructUtils";
import { signAddCollateralRequest, signClosePositionRequest, signOpenPositionRequest, signRemoveCollateralRequest } from "./utils/SigningUtils";
import { deployShortPoolMockEnvironment, deployWasabiShortPool } from "./fixtures";
import { getApproveAndSwapExactlyOutFunctionCallData, getApproveAndSwapFunctionCallData, getApproveAndSwapFunctionCallDataExact } from "./utils/SwapUtils";

describe("WasabiShortPool - Validations Test", function () {
    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            const { wasabiShortPool, manager } = await loadFixture(deployWasabiShortPool);
            expect(await wasabiShortPool.read.owner()).to.equal(getAddress(manager.address));
        });

        it("Cannot reinitialize", async function () {
            const { wasabiShortPool, manager } = await loadFixture(deployWasabiShortPool);
            await expect(wasabiShortPool.write.initialize([manager.address]))
                .to.be.rejectedWith("InvalidInitialization");
        })
    });

    describe("Open Position Validations", function () {
        it("PrincipalTooHigh - checkMaxLeverage", async function () {
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

        it("PrincipalTooHigh - amountSpent > principal", async function () {
            const { wasabiShortPool, orderSigner, user1, totalAmountIn, mockSwap, uPPG, wethAddress, contractName, openPositionRequest, maxLeverage, tradeFeeValue, initialPPGPrice, priceDenominator } = await loadFixture(deployShortPoolMockEnvironment);

            // Send the pool a little extra principal token to spend
            await uPPG.write.mint([wasabiShortPool.address, 1n]);
    
            const leverage = maxLeverage / 100n;
            const fee = getFee(totalAmountIn * (leverage + 1n), tradeFeeValue);
            const downPayment = totalAmountIn - fee;
        
            const swappedAmount = downPayment * initialPPGPrice / priceDenominator;
            const principal = swappedAmount * (leverage + 1n);

            let functionCallDataList: FunctionCallData[] =
                getApproveAndSwapFunctionCallDataExact(mockSwap.address, uPPG.address, wethAddress, principal + 1n, openPositionRequest.minTargetAmount);
            
            let request: OpenPositionRequest = {
                ...openPositionRequest,
                functionCallDataList,
                principal
            };
            let signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);
    
            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("PrincipalTooHigh", "Principal is too high");

            functionCallDataList =
                getApproveAndSwapFunctionCallDataExact(mockSwap.address, uPPG.address, wethAddress, principal - 1n, openPositionRequest.minTargetAmount);
            request = {
                ...openPositionRequest,
                functionCallDataList,
                principal
            };
            signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.fulfilled;
        })

        it("InsufficientCollateralReceived", async function () {
            const { wasabiShortPool, orderSigner, user1, totalAmountIn, mockSwap, uPPG, wethAddress, contractName, openPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
    
            const principalThatWillBeUsed = openPositionRequest.principal * 97n / 100n;

            const functionCallDataList: FunctionCallData[] =
                getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principalThatWillBeUsed);
            
            const request: OpenPositionRequest = {
                ...openPositionRequest,
                functionCallDataList
            };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);
    
            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InsufficientCollateralReceived", "Not enough collateral received due to too little principal used");
        });

        it("InsufficientPrincipalUsed", async function () {
            const { wasabiShortPool, user1, openPositionRequest, totalAmountIn, orderSigner, contractName } = await loadFixture(deployShortPoolMockEnvironment);
            
            const request: OpenPositionRequest = { ...openPositionRequest, principal: 0n };
            const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InsufficientPrincipalUsed", "Cannot open positions with zero principal");
        })

        it("SenderNotTrader", async function () {
            const { wasabiShortPool, user1, user2, openPositionRequest, signature } = await loadFixture(deployShortPoolMockEnvironment);

            await expect(wasabiShortPool.write.openPositionFor([openPositionRequest, signature, user2.account.address], { account: user1.account }))
                .to.be.rejectedWith("SenderNotTrader", "Cannot open position for another user");
        });

        it("InvalidPosition", async function () {
            const { wasabiShortPool, user1, openPositionRequest, totalAmountIn, contractName, orderSigner } = await loadFixture(deployShortPoolMockEnvironment);

            const existingPosition = getEmptyPosition();
            let request: OpenPositionRequest = { ...openPositionRequest, existingPosition: { ...existingPosition, downPayment: 1n} };
            let signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidPosition", "Existing position must be empty when opening a new position");

            request = { ...openPositionRequest, existingPosition: { ...existingPosition, principal: 1n} };
            signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidPosition", "Existing position must be empty when opening a new position");
            
            request = { ...openPositionRequest, existingPosition: { ...existingPosition, collateralAmount: 1n} };
            signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidPosition", "Existing position must be empty when opening a new position");
            
            request = { ...openPositionRequest, existingPosition: { ...existingPosition, feesToBePaid: 1n} };
            signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.openPosition([request, signature], { value: totalAmountIn, account: user1.account }))
                .to.be.rejectedWith("InvalidPosition", "Existing position must be empty when opening a new position");
        });
    });

    describe("Edit Position Validations", function () {
        describe("Increase Position", function () {
            it("InvalidPosition - stored hash != request.existingPosition.hash", async function () {
                const { wasabiShortPool, mockSwap, wethAddress, uPPG, user1, totalAmountIn, principal, initialPPGPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
                
                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principal);
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id,
                    currency: position.currency,
                    targetCurrency: position.collateralCurrency,
                    downPayment: position.downPayment,
                    principal: position.principal,
                    minTargetAmount: principal * initialPPGPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    referrer: zeroAddress
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, openPositionRequest);

                // Increase position
                await wasabiShortPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account });

                await time.increase(86400n); // 1 day later

                // Try to reuse the same request
                await expect(wasabiShortPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InvalidPosition", "Cannot reuse the same request to increase position twice");
            });

            it("InvalidCurrency", async function () {
                const { wasabiShortPool, mockSwap, wethAddress, uPPG, user1, totalAmountIn, principal, initialPPGPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
                
                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principal);
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id,
                    currency: position.collateralCurrency, // Incorrect currency
                    targetCurrency: position.collateralCurrency,
                    downPayment: position.downPayment,
                    principal: position.principal,
                    minTargetAmount: principal * initialPPGPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    referrer: zeroAddress
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, openPositionRequest);

                await expect(wasabiShortPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InvalidCurrency", "request.currency must match request.existingPosition.currency");
            });

            it("InvalidTargetCurrency", async function () {
                const { wasabiShortPool, mockSwap, wethAddress, uPPG, user1, totalAmountIn, principal, initialPPGPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
                
                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principal);
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id,
                    currency: position.currency,
                    targetCurrency: position.currency, // Incorrect target currency
                    downPayment: position.downPayment,
                    principal: position.principal,
                    minTargetAmount: principal * initialPPGPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    referrer: zeroAddress
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, openPositionRequest);

                await expect(wasabiShortPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InvalidTargetCurrency", "request.targetCurrency must match request.existingPosition.collateralCurrency");
            });

            it("SenderNotTrader", async function () {
                const { wasabiShortPool, mockSwap, wethAddress, uPPG, user2, totalAmountIn, principal, initialPPGPrice, priceDenominator, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
                
                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const functionCallDataList: FunctionCallData[] =
                    getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principal);
                const openPositionRequest: OpenPositionRequest = {
                    id: position.id,
                    currency: position.currency,
                    targetCurrency: position.collateralCurrency,
                    downPayment: position.downPayment,
                    principal: position.principal,
                    minTargetAmount: principal * initialPPGPrice / priceDenominator,
                    expiration: BigInt(await time.latest()) + 86400n,
                    fee: position.feesToBePaid,
                    functionCallDataList,
                    existingPosition: position,
                    referrer: zeroAddress
                };
                const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, openPositionRequest);

                await expect(wasabiShortPool.write.openPosition([openPositionRequest, signature], { value: totalAmountIn, account: user2.account }))
                    .to.be.rejectedWith("SenderNotTrader", "Cannot increase position on behalf of other traders");
            });
        });

        describe("Add Collateral", function () {
            it("InsufficientAmountProvided", async function () {
                const { wasabiShortPool, user1, totalAmountIn, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const request: AddCollateralRequest = {
                    amount: 0n,
                    interest: 0n,
                    expiration: BigInt(await time.latest()) + 86400n,
                    position
                }
                const signature = await signAddCollateralRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.addCollateral([request, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InsufficientAmountProvided", "Cannot add 0 collateral");
            });

            it("InvalidInterestAmount", async function () {
                const { wasabiShortPool, user1, totalAmountIn, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const request: AddCollateralRequest = {
                    amount: totalAmountIn,
                    interest: 1n,
                    expiration: BigInt(await time.latest()) + 86400n,
                    position
                }
                const signature = await signAddCollateralRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.addCollateral([request, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InvalidInterestAmount", "Cannot pay interest when adding collateral to short position");
            });

            it("InvalidPosition", async function () {
                const { wasabiShortPool, user1, totalAmountIn, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
                
                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const request: AddCollateralRequest = {
                    amount: totalAmountIn,
                    interest: 0n,
                    expiration: BigInt(await time.latest()) + 86400n,
                    position: {...position, id: position.id + 1n}
                }
                const signature = await signAddCollateralRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.addCollateral([request, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("InvalidPosition", "Cannot add collateral to a position with a different ID");
            });

            it("SenderNotTrader", async function () {
                const { wasabiShortPool, user2, totalAmountIn, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
                
                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const request: AddCollateralRequest = {
                    amount: totalAmountIn,
                    interest: 0n,
                    expiration: BigInt(await time.latest()) + 86400n,
                    position
                }
                const signature = await signAddCollateralRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.addCollateral([request, signature], { value: totalAmountIn, account: user2.account }))
                    .to.be.rejectedWith("SenderNotTrader", "Cannot add collateral on behalf of other traders");
            })

            it("OrderExpired", async function () {
                const { wasabiShortPool, user1, totalAmountIn, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const request: AddCollateralRequest = {
                    amount: totalAmountIn,
                    interest: 0n,
                    expiration: BigInt(await time.latest()) - 1n,
                    position
                }
                const signature = await signAddCollateralRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.addCollateral([request, signature], { value: totalAmountIn, account: user1.account }))
                    .to.be.rejectedWith("OrderExpired", "Cannot add collateral to a position if the order is expired");
            })
        });

        describe("Remove Collateral", function () {
            it("InsufficientAmountProvided", async function () {
                const { wasabiShortPool, user1, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const request: RemoveCollateralRequest = {  
                    amount: 0n,
                    expiration: BigInt(await time.latest()) + 86400n,
                    position
                }
                const signature = await signRemoveCollateralRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.removeCollateral([request, signature], { account: user1.account }))
                    .to.be.rejectedWith("InsufficientAmountProvided", "Cannot remove 0 collateral");
            });

            it("OrderExpired", async function () {
                const { wasabiShortPool, user1, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const request: RemoveCollateralRequest = {
                    amount: position.collateralAmount,
                    expiration: BigInt(await time.latest()) - 1n,
                    position
                }
                const signature = await signRemoveCollateralRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.removeCollateral([request, signature], { account: user1.account }))
                    .to.be.rejectedWith("OrderExpired", "Cannot remove collateral if the order is expired");
            });

            it("InvalidPosition", async function () {
                const { wasabiShortPool, user1, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const request: RemoveCollateralRequest = {
                    amount: position.collateralAmount,
                    expiration: BigInt(await time.latest()) + 86400n,
                    position: {...position, id: position.id + 1n}
                }
                const signature = await signRemoveCollateralRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.removeCollateral([request, signature], { account: user1.account }))
                    .to.be.rejectedWith("InvalidPosition", "Cannot remove collateral to a position with a different ID");
            });

            it("SenderNotTrader", async function () {
                const { wasabiShortPool, user2, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const request: RemoveCollateralRequest = {
                    amount: 1n,
                    expiration: BigInt(await time.latest()) + 86400n,
                    position
                }
                const signature = await signRemoveCollateralRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.removeCollateral([request, signature], { account: user2.account }))
                    .to.be.rejectedWith("SenderNotTrader", "Cannot remove collateral to a position on behalf of other traders");
            });

            it("TooMuchCollateralSpent", async function () {
                const { wasabiShortPool, user1, orderSigner, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
                
                // Open Position
                const {position} = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later
                
                const request: RemoveCollateralRequest = {
                    amount: position.collateralAmount + 1n,
                    expiration: BigInt(await time.latest()) + 86400n,
                    position
                }
                const signature = await signRemoveCollateralRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.removeCollateral([request, signature], { account: user1.account }))
                    .to.be.rejectedWith("TooMuchCollateralSpent", "Too much collateral");
            });
        });

        describe("Decrease Position", function () {
            it("InsufficientPrincipalRepaid", async function () {
                const { createClosePositionRequest, signClosePositionRequest, wasabiShortPool, orderSigner, user1, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

                const { position } = await sendDefaultOpenPositionRequest();

                await time.increase(86400n); // 1 day later

                const request = await createClosePositionRequest({ position, amount: position.principal / 2n });
                // Increase amount to buy to be more than what will be bought using the generated swap function call
                request.amount = position.principal;
                const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

                await expect(wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                    .to.be.rejectedWith("InsufficientPrincipalRepaid", "Too much collateral");
            });

            it("ValueDeviatedTooMuch - Interest Paid", async function () {
                const { computeMaxInterest, createClosePositionRequest, signClosePositionRequest, wasabiShortPool, orderSigner, user1, mockSwap, contractName, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);
    
                const { position } = await sendDefaultOpenPositionRequest();
    
                await time.increase(86400n); // 1 day later
    
                const interest = (await computeMaxInterest(position)) / 2n;
                const amount = position.principal / 2n;
                const request = await createClosePositionRequest({ position, interest });
                request.interest = interest * 105n / 100n; // Change interest to be invalid
                const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);
    
                await expect(wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                    .to.be.rejectedWith("ValueDeviatedTooMuch", "Interest amount is invalid");
            });
        });
    });

    describe("Close Position Validations", function () {
        it("InvalidPosition", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionRequest, owner, user1, user2, wasabiShortPool } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            // Change the position
            position.collateralAmount = position.collateralAmount * 2n;
            const { request, signature } = await createSignedClosePositionRequest({position});

            await expect(wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                .to.be.rejectedWith("InvalidPosition", "Only valid positions can be closed");
        });

        it("SwapFunctionNeeded", async function () {
            const { sendDefaultOpenPositionRequest, orderSigner, user1, contractName, wasabiShortPool } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            const request: ClosePositionRequest = {
                expiration: BigInt(await time.latest()) + 300n,
                interest: 0n,
                amount: 0n,
                position,
                functionCallDataList: [],
                referrer: zeroAddress
            };
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                .to.be.rejectedWith("SwapFunctionNeeded", "Swap functions are needed for short close");
        });

        it("ValueDeviatedTooMuch - Interest Paid", async function () {
            const { computeMaxInterest, createClosePositionRequest, signClosePositionRequest, createSignedClosePositionRequest, wasabiShortPool, orderSigner, user1, totalAmountIn, maxLeverage, owner, tradeFeeValue, contractName, openPositionRequest, initialPPGPrice, priceDenominator, sendDefaultOpenPositionRequest } = await loadFixture(deployShortPoolMockEnvironment);

            const { position } = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Close Position
            const interest = (await computeMaxInterest(position)) / 2n;
            const request = await createClosePositionRequest({ position, interest });
            request.interest = interest * 105n / 100n; // Change interest to be invalid
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
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
            const request = await createClosePositionRequest({ position, interest, amount: position.principal + 1n });
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
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
                amount: 0n,
                position,
                functionCallDataList: getApproveAndSwapFunctionCallDataExact(mockSwap.address, position.collateralCurrency, position.currency, position.collateralAmount, 1n), // bad amountOut
                referrer: zeroAddress
            };
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                .to.be.rejectedWith("InsufficientPrincipalRepaid");
        })

        it("OrderExpired", async function () {
            const { sendDefaultOpenPositionRequest, orderSigner, user1, contractName, wasabiShortPool } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();
            const request: ClosePositionRequest = {
                expiration: BigInt(await time.latest()) - 1n,
                interest: 0n,
                amount: 0n,
                position,
                functionCallDataList: [],
                referrer: zeroAddress
            };
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);

            await expect(wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account }))
                .to.be.rejectedWith("OrderExpired", "Position cannot be closed if order is expired");
        })
        

        it("AccessManagerUnauthorizedAccount", async function () {
            const { sendDefaultOpenPositionRequest, createSignedClosePositionOrder, orderSigner, user1, user2, contractName, wasabiShortPool } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            const request: ClosePositionRequest = {
                expiration: BigInt(await time.latest()) + 300n,
                interest: 0n,
                amount: 0n,
                position,
                functionCallDataList: [],
                referrer: zeroAddress
            };
            const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);
            // Take Profit Order
            const {request: order, signature: orderSignature} = await createSignedClosePositionOrder({
                orderType: OrderType.TP,
                traderSigner: user2, // Wrong order signer
                positionId: position.id,
                makerAmount: position.collateralAmount,
                takerAmount: (position.principal + position.downPayment) * 2n,
                expiration: await time.latest() + 172800,
                executionFee: parseEther("0.05"),
            });

            await expect(wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, request, signature, order, orderSignature], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only the liquidator can close positions with TP/SL orders");
        })

        it("AccessManagerUnauthorizedAccount - Liquidation", async function () {
            const { sendDefaultOpenPositionRequest, user1, wasabiShortPool } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            await expect(wasabiShortPool.write.liquidatePosition([PayoutType.UNWRAPPED, 0n, position, [], zeroAddress], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only the liquidator can liquidate positions");
        })
    });

    describe("Record Interest Validations", function () {
        it("AccessManagerUnauthorizedAccount", async function () {
            const { sendDefaultOpenPositionRequest, user1, wasabiShortPool } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            await expect(wasabiShortPool.write.recordInterest([[position], [0n], []], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only the liquidator can record interest");
        });

        it("InvalidInput", async function () {
            const { sendDefaultOpenPositionRequest, orderExecutor, wasabiShortPool } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            await expect(wasabiShortPool.write.recordInterest([[position], [0n, 0n], []], { account: orderExecutor.account }))
                .to.be.rejectedWith("InvalidInput", "Positions length mismatch");
        });

        it("SwapFunctionNeeded", async function () {
            const { sendDefaultOpenPositionRequest, orderExecutor, wasabiShortPool } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            await expect(wasabiShortPool.write.recordInterest([[position], [0n], []], { account: orderExecutor.account }))
                .to.be.rejectedWith("SwapFunctionNeeded", "Swap functions are needed for short interest");
        });

        it("InvalidPosition", async function () {
            const { sendDefaultOpenPositionRequest, computeMaxInterest, orderExecutor, wasabiShortPool, mockSwap } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            const interest = await computeMaxInterest(position);
            const swapFunctions = getApproveAndSwapExactlyOutFunctionCallData(mockSwap.address, position.collateralCurrency, position.currency, 0n, interest);

            await expect(wasabiShortPool.write.recordInterest([[{...position, principal: position.principal + 1n}], [0n], swapFunctions], { account: orderExecutor.account }))
                .to.be.rejectedWith("InvalidPosition", "Position is not valid");
        });

        it("InvalidInterestAmount - Too high", async function () {
            const { sendDefaultOpenPositionRequest, computeMaxInterest, orderExecutor, wasabiShortPool, mockSwap } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            const interest = await computeMaxInterest(position);
            const swapFunctions = getApproveAndSwapExactlyOutFunctionCallData(mockSwap.address, position.collateralCurrency, position.currency, 0n, interest);

            await expect(wasabiShortPool.write.recordInterest([[position], [interest + 1n], swapFunctions], { account: orderExecutor.account }))
                .to.be.rejectedWith("InvalidInterestAmount", "Interest amount is not valid");
        });

        it("InvalidInterestAmount - Too low", async function () {
            const { sendDefaultOpenPositionRequest, computeMaxInterest, orderExecutor, wasabiShortPool, mockSwap } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            const interest = await computeMaxInterest(position);
            const swapFunctions = getApproveAndSwapExactlyOutFunctionCallData(mockSwap.address, position.collateralCurrency, position.currency, 0n, interest);

            await expect(wasabiShortPool.write.recordInterest([[position], [0n], swapFunctions], { account: orderExecutor.account }))
                .to.be.rejectedWith("InvalidInterestAmount", "Interest amount is not valid");
        });

        it("InvalidTargetCurrency", async function () {
            const { sendDefaultOpenPositionRequest, sendUSDCOpenPositionRequest, computeMaxInterest, orderExecutor, wasabiShortPool, mockSwap } = await loadFixture(deployShortPoolMockEnvironment);
            const { position: wethPosition } = await sendDefaultOpenPositionRequest();
            const { position: usdcPosition } = await sendUSDCOpenPositionRequest(2n);

            const interestWeth = await computeMaxInterest(wethPosition);
            const interestUsdc = await computeMaxInterest(usdcPosition);
            const swapFunctions = getApproveAndSwapExactlyOutFunctionCallData(mockSwap.address, wethPosition.collateralCurrency, wethPosition.currency, 0n, interestWeth);

            await expect(wasabiShortPool.write.recordInterest([[wethPosition, usdcPosition], [interestWeth, interestUsdc], swapFunctions], { account: orderExecutor.account }))
                .to.be.rejectedWith("InvalidTargetCurrency", "Target currency is not valid");
        });

        it("InvalidCurrency", async function () {
            const { sendUSDCOpenPositionRequest, sendOpenPositionRequest, computeMaxInterest, orderExecutor, wasabiShortPool, mockSwap, tradeFeeValue, initialUSDCPrice, priceDenominator, initialPPGPrice, weth, usdc, uPPG, owner, vault, wethVault } = await loadFixture(deployShortPoolMockEnvironment);

            // Add more assets to the vault for borrowing
            await uPPG.write.mint([owner.account.address, parseEther("100")], { account: owner.account });
            await uPPG.write.approve([vault.address, parseEther("100")], { account: owner.account });
            await vault.write.deposit([parseEther("100"), owner.account.address], { account: owner.account });
            await wethVault.write.depositEth([owner.account.address], { value: parseEther("100"), account: owner.account });

            // Open a uPPG/USDC position
            const positions = [];
            const { position: position1 } = await sendUSDCOpenPositionRequest();
            positions.push(position1);

            // Open a WETH/USDC position
            const leverage = 5n;
            const totalAmountIn = parseUnits("500", 6);
            const fee = getFee(totalAmountIn * (leverage + 1n), tradeFeeValue);
            const downPayment = totalAmountIn - fee;
            const swappedAmount = downPayment * (10n ** (18n - 6n)) * initialUSDCPrice / priceDenominator;
            const principal = swappedAmount * leverage;
            const minTargetAmount = principal * initialPPGPrice / initialUSDCPrice / (10n ** (18n - 6n));

            const functionCallDataList: FunctionCallData[] = 
                getApproveAndSwapFunctionCallData(mockSwap.address, weth.address, usdc.address, principal);
            const openPositionRequest: OpenPositionRequest = {
                id: 2n,
                currency: weth.address,
                targetCurrency: usdc.address,
                downPayment,
                principal,
                minTargetAmount,
                expiration: BigInt(await time.latest()) + 86400n,
                fee,
                functionCallDataList,
                existingPosition: getEmptyPosition(),
                referrer: zeroAddress
            };
            const { position: position2 } = await sendOpenPositionRequest(openPositionRequest);
            positions.push(position2);

            const interests = [];
            let totalInterest = 0n;
            for (let i = 0; i < 2; i++) {
                const interest = await computeMaxInterest(positions[i]);
                interests.push(interest);
                totalInterest += interest;
            }

            const swapFunctions = getApproveAndSwapExactlyOutFunctionCallData(mockSwap.address, position1.collateralCurrency, position1.currency, 0n, totalInterest);

            await expect(wasabiShortPool.write.recordInterest([positions, interests, swapFunctions], { account: orderExecutor.account }))
                .to.be.rejectedWith("InvalidCurrency", "Currency is not valid");
        });

        it("InsufficientPrincipalRepaid", async function () {
            const { sendDefaultOpenPositionRequest, computeMaxInterest, orderExecutor, wasabiShortPool, mockSwap } = await loadFixture(deployShortPoolMockEnvironment);
            const { position } = await sendDefaultOpenPositionRequest();

            const interest = await computeMaxInterest(position);
            const swapFunctions = getApproveAndSwapExactlyOutFunctionCallData(mockSwap.address, position.collateralCurrency, position.currency, 0n, interest - 1n);

            await expect(wasabiShortPool.write.recordInterest([[position], [interest], swapFunctions], { account: orderExecutor.account }))
                .to.be.rejectedWith("InsufficientPrincipalRepaid", "Insufficient principal repaid");
        });
    });
});