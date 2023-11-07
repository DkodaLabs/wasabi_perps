import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther, zeroAddress, encodeFunctionData, formatEther } from "viem";
import { ClosePositionRequest, FunctionCallData, OpenPositionRequest, Position, formatEthValue, getEventPosition, getValueWithoutFee } from "./utils/PerpStructUtils";
import { signOpenPositionRequest, getDomainData, EIP712Domain, Signature } from "./utils/SigningUtils";
import { getSwapFunctionCallData, getERC20ApproveFunctionCallData, getApproveAndSwapFunctionCallData } from "./utils/SwapUtils";
import { deployFeeController } from "./fixtures";

describe("WasabiLongPool", function () {

    async function deployMockEnvironment() {
        const wasabiLongPool = await deployWasabiLongPool();
        const [owner] = await hre.viem.getWalletClients();

        const initialPrice = 10_000n;
        const mockSwap = await hre.viem.deployContract("MockSwap", [], { value: parseEther("50") });
        const uPPG = await hre.viem.deployContract("MockERC20", ["μPudgyPenguins", 'μPPG']);
        await uPPG.write.mint([mockSwap.address, parseEther("50")]);
        await mockSwap.write.setPrice([uPPG.address, zeroAddress, initialPrice]);

        const downPayment = parseEther("1");
        const principal = getValueWithoutFee(parseEther("3"), wasabiLongPool.tradeFeeValue);
        const amount = getValueWithoutFee(downPayment, wasabiLongPool.tradeFeeValue) + principal;

        const functionCallDataList: FunctionCallData[] =
            getApproveAndSwapFunctionCallData(mockSwap.address, zeroAddress, uPPG.address, amount);
        
        const openPositionRequest: OpenPositionRequest = {
            id: 1n,
            currency: zeroAddress,
            targetCurrency: uPPG.address,
            downPayment: parseEther("1"),
            principal: getValueWithoutFee(parseEther("3"), wasabiLongPool.tradeFeeValue),
            minTargetAmount: parseEther("3"),
            expiration: BigInt(await time.latest()) + 86400n,
            swapPrice: 0n,
            swapPriceDenominator: 0n,
            functionCallDataList 
        };
        const signature = await signOpenPositionRequest(owner, wasabiLongPool.wasabiLongPool.address, openPositionRequest);

        return {
            ...wasabiLongPool,
            mockSwap,
            uPPG,
            openPositionRequest,
            downPayment,
            signature,
            initialPrice
        }
    }

    async function deployWasabiLongPool() {
        const feeControllerFixture = await deployFeeController();

        // Setup
        const [owner, user1] = await hre.viem.getWalletClients();
        owner.signTypedData
        const publicClient = await hre.viem.getPublicClient();

        // Deploy DebtController
        const maxApy = 300n; // 300% APY
        const maxLeverage = 500n; // 5x Leverage
        const debtController = await hre.viem.deployContract("DebtController", [maxApy, maxLeverage]);

        // Deploy WasabiLongPool
        const wasabiLongPool = 
            await hre.viem.deployContract(
                "WasabiLongPool",
                [debtController.address, feeControllerFixture.feeController.address],
                { value: parseEther("10") });

        return {
            ...feeControllerFixture,
            wasabiLongPool,
            debtController,
            maxApy,
            maxLeverage,
            owner,
            user1,
            publicClient,
        };
    }

    describe("Deployment", function () {
        it("Should set the right debt controller", async function () {
            const { wasabiLongPool, debtController } = await loadFixture(deployWasabiLongPool);
            expect(await wasabiLongPool.read.debtController()).to.equal(getAddress(debtController.address));
        });

        it("Should set the right fee controller", async function () {
            const { wasabiLongPool, feeController } = await loadFixture(deployWasabiLongPool);
            expect(await wasabiLongPool.read.feeController()).to.equal(getAddress(feeController.address));
        });

        it("Should have correct domain", async function () {
            const { wasabiLongPool } = await loadFixture(deployWasabiLongPool);
            const domain = await wasabiLongPool.read.getDomainData().then(d => ({
                name: d.name,
                version: d.version,
                chainId: Number(d.chainId),
                verifyingContract: d.verifyingContract
            }));
            expect(domain).to.deep.equal(getDomainData(wasabiLongPool.address));
        });

        it("Should set the right owner", async function () {
            const { wasabiLongPool, owner } = await loadFixture(deployWasabiLongPool);
            expect(await wasabiLongPool.read.owner()).to.equal(getAddress(owner.account.address));
        });
    });

    describe("Trading", function () {
        it("Open Position", async function () {
            const { wasabiLongPool, tradeFeeValue, uPPG, user1, openPositionRequest, downPayment, signature } = await loadFixture(deployMockEnvironment);

            await wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account });

            const events = await wasabiLongPool.getEvents.OpenPosition();
            expect(events).to.have.lengthOf(1);
            expect(events[0].args.positionId).to.equal(openPositionRequest.id);
            expect(events[0].args.downPayment).to.equal(getValueWithoutFee(downPayment, tradeFeeValue));
            expect(events[0].args.collateralAmount).to.equal(await uPPG.read.balanceOf([wasabiLongPool.address]));
        });

        it("Close Position - price not changed", async function () {
            const { owner, publicClient, wasabiLongPool, user1, uPPG, mockSwap, openPositionRequest, downPayment, signature, feeReceiver } = await loadFixture(deployMockEnvironment);

            // Open Position
            await wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account });
            const openPositionEvent = (await wasabiLongPool.getEvents.OpenPosition())[0];
            const position: Position = await getEventPosition(openPositionEvent);

            await time.increase(86400n); // 1 day later

            // Close Position
            const closePositionRequest: ClosePositionRequest = {
                position,
                functionCallDataList: getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, zeroAddress, position.collateralAmount),
            };
            const closePositionSignature = await signOpenPositionRequest(owner, wasabiLongPool.address, openPositionRequest);

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceBefore = await publicClient.getBalance({address: wasabiLongPool.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition([closePositionRequest, closePositionSignature], { account: user1.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceAfter = await publicClient.getBalance({address: wasabiLongPool.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.ClosePosition();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(poolBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid! - position.feesToBePaid).to.equal(poolBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(0, "Total return should be 0 on no price change");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        it("Close Position - price increased", async function () {

            const { owner, publicClient, wasabiLongPool, user1, uPPG, mockSwap, openPositionRequest, downPayment, signature, feeReceiver, initialPrice } = await loadFixture(deployMockEnvironment);

            // Open Position
            const openHash = await wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account });
            const gasUsedForOpen = await publicClient.getTransactionReceipt({hash: openHash}).then(r => r.gasUsed * r.effectiveGasPrice);
            // console.log('gas used to open', formatEthValue(gasUsedForOpen, 8));

            const openPositionEvent = (await wasabiLongPool.getEvents.OpenPosition())[0];
            const position: Position = await getEventPosition(openPositionEvent);

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, zeroAddress, initialPrice * 2n]); // Price doubled

            // Close Position
            const closePositionRequest: ClosePositionRequest = {
                position,
                functionCallDataList: getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, zeroAddress, position.collateralAmount),
            };
            const closePositionSignature = await signOpenPositionRequest(owner, wasabiLongPool.address, openPositionRequest);

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceBefore = await publicClient.getBalance({address: wasabiLongPool.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition([closePositionRequest, closePositionSignature], { account: user1.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceAfter = await publicClient.getBalance({address: wasabiLongPool.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.ClosePosition();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(poolBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid! - position.feesToBePaid).to.equal(poolBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(position.downPayment * 4n, "on 2x price increase, total return should be 4x down payment");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);

            // console.log('gas used to close', formatEthValue(gasUsed, 8));
        });

        it("Close Position - price decreased", async function () {
            const { owner, publicClient, wasabiLongPool, user1, uPPG, mockSwap, openPositionRequest, downPayment, signature, feeReceiver, initialPrice } = await loadFixture(deployMockEnvironment);

            // Open Position
            await wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account });
            const openPositionEvent = (await wasabiLongPool.getEvents.OpenPosition())[0];
            const position: Position = await getEventPosition(openPositionEvent);

            await time.increase(86400n); // 1 day later
            await mockSwap.write.setPrice([uPPG.address, zeroAddress, initialPrice * 8n / 10n]); // Price fell 20%

            // Close Position
            const closePositionRequest: ClosePositionRequest = {
                position,
                functionCallDataList: getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, zeroAddress, position.collateralAmount),
            };
            const closePositionSignature = await signOpenPositionRequest(owner, wasabiLongPool.address, openPositionRequest);

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceBefore = await publicClient.getBalance({address: wasabiLongPool.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.closePosition([closePositionRequest, closePositionSignature], { account: user1.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceAfter = await publicClient.getBalance({address: wasabiLongPool.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.ClosePosition();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const totalFeesPaid = closePositionEvent.feeAmount! + position.feesToBePaid;

            expect(closePositionEvent.id).to.equal(position.id);
            expect(closePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(poolBalanceBefore + closePositionEvent.principalRepaid! + closePositionEvent.interestPaid! - position.feesToBePaid).to.equal(poolBalanceAfter);

            const totalReturn = closePositionEvent.payout! + closePositionEvent.interestPaid! + closePositionEvent.feeAmount! - position.downPayment;
            expect(totalReturn).to.equal(position.downPayment / -5n * 4n, "on 20% price decrease, total return should be -20% * leverage (4) * down payment");

            // Check trader has been paid
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(traderBalanceAfter - traderBalanceBefore + gasUsed).to.equal(closePositionEvent.payout!);

            // Check fees have been paid
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore).to.equal(totalFeesPaid);
        });

        it("Liquidate Position", async function () {
            const { owner, publicClient, wasabiLongPool, user1, uPPG, mockSwap, openPositionRequest, downPayment, signature, feeReceiver, tradeFeeValue, feeDenominator, debtController, initialPrice } = await loadFixture(deployMockEnvironment);

            // Open Position
            await wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account });
            const openPositionEvent = (await wasabiLongPool.getEvents.OpenPosition())[0];
            const position: Position = await getEventPosition(openPositionEvent);

            await time.increase(86400n); // 1 day later

            // Liquidate Position
            const functionCallDataList = getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, zeroAddress, position.collateralAmount);

            // Compute liquidation price
            const currentInterest = await debtController.read.computeMaxInterest([position.collateralCurrency, position.principal, position.lastFundingTimestamp]);
            const liquidationThreshold = position.principal * 5n / 100n;
            const payoutLiquidationThreshold = liquidationThreshold * feeDenominator / (feeDenominator - tradeFeeValue);
            const liquidationAmount = payoutLiquidationThreshold + position.principal + currentInterest;
            const liquidationPrice = liquidationAmount * 10_000n / position.collateralAmount;

            // If the liquidation price is not reached, should revert
            await mockSwap.write.setPrice([uPPG.address, zeroAddress, liquidationPrice + 1n]); 
            await expect(wasabiLongPool.write.liquidatePosition([position, functionCallDataList], { account: owner.account }))
                .to.be.rejectedWith("LiquidationThresholdNotReached", "Cannot liquidate position if liquidation price is not reached");

            // Liquidate
            await mockSwap.write.setPrice([uPPG.address, zeroAddress, liquidationPrice]); 

            const traderBalanceBefore = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceBefore = await publicClient.getBalance({address: wasabiLongPool.address });
            const feeReceiverBalanceBefore = await publicClient.getBalance({address: feeReceiver });

            const hash = await wasabiLongPool.write.liquidatePosition([position, functionCallDataList], { account: owner.account });

            const traderBalanceAfter = await publicClient.getBalance({address: user1.account.address });
            const poolBalanceAfter = await publicClient.getBalance({address: wasabiLongPool.address });
            const feeReceiverBalanceAfter = await publicClient.getBalance({address: feeReceiver });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionLiquidated();
            expect(events).to.have.lengthOf(1);
            const liquidatePositionEvent = events[0].args;
            const totalFeesPaid = liquidatePositionEvent.feeAmount! + position.feesToBePaid;

            expect(liquidatePositionEvent.id).to.equal(position.id);
            expect(liquidatePositionEvent.principalRepaid!).to.equal(position.principal);
            expect(await uPPG.read.balanceOf([wasabiLongPool.address])).to.equal(0n, "Pool should not have any collateral left");

            expect(poolBalanceBefore + liquidatePositionEvent.principalRepaid! + liquidatePositionEvent.interestPaid! - position.feesToBePaid).to.equal(poolBalanceAfter);

            // Check trader has been paid
            expect(traderBalanceAfter - traderBalanceBefore).to.equal(liquidatePositionEvent.payout!);

            // Check fees have been paid
            // Include gas since the liquidator is the fee receiver
            const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            expect(feeReceiverBalanceAfter - feeReceiverBalanceBefore + gasUsed).to.equal(totalFeesPaid);
        });
    });
})
