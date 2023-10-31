import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther, zeroAddress, encodeFunctionData, Address } from "viem";
import { ClosePositionRequest, FunctionCallData, OpenPositionRequest, Position, getERC20ApproveFunctionCallData, getEventPosition, getValueWithoutFee, signOpenPositionRequest } from "./utils/PerpStructUtils";

describe("WasabiPerps", function () {

    async function deployMockEnvironment() {
        const wasabiPerps = await deployWasabiPerps();
        const [owner] = await hre.viem.getWalletClients();

        const mockSwap = await hre.viem.deployContract("MockSwap", [], { value: parseEther("50") });
        const uPPG = await hre.viem.deployContract("MockERC20", ["μPudgyPenguins", 'μPPG']);
        await uPPG.write.mint([mockSwap.address, parseEther("50")]);
        await mockSwap.write.setPrice([zeroAddress, uPPG.address, 10_000n]);

        const downPayment = parseEther("1");
        const principal = getValueWithoutFee(parseEther("3"), wasabiPerps.feeValue);
        const amount = getValueWithoutFee(downPayment, wasabiPerps.feeValue) + principal;

        const functionCallDataList: FunctionCallData[] = [
            {
                to: mockSwap.address,
                value: amount,
                data: encodeFunctionData({
                    abi: [mockSwap.abi.find(a => a.type === "function" && a.name === "swap")!],
                    functionName: "swap",
                    args: [zeroAddress, amount, uPPG.address]
                })
            }
        ];
        const openPositionRequest: OpenPositionRequest = {
            id: 1n,
            currency: zeroAddress,
            targetCurrency: uPPG.address,
            downPayment: parseEther("1"),
            principal: getValueWithoutFee(parseEther("3"), wasabiPerps.feeValue),
            minTargetAmount: parseEther("3"),
            expiration: BigInt(await time.latest()) + 86400n,
            functionCallDataList
        }
        const signature = await signOpenPositionRequest(owner, wasabiPerps.wasabiPerps.address, openPositionRequest);

        return {
            ...wasabiPerps,
            mockSwap,
            uPPG,
            openPositionRequest,
            downPayment,
            signature
        }
    }

    async function deployWasabiPerps() {
        // Setup
        const [owner, user1] = await hre.viem.getWalletClients();
        owner.signTypedData
        const publicClient = await hre.viem.getPublicClient();

        // Deploy DebtController
        const maxApy = 300n; // 300% APY
        const maxLeverage = 500n; // 5x Leverage
        const debtController = await hre.viem.deployContract("DebtController", [maxApy, maxLeverage]);

        // Deploy WasabiPerps
        const feeValue = 50n; // 0.5%
        const wasabiPerps = await hre.viem.deployContract("WasabiPerps", [debtController.address, feeValue], { value: parseEther("10") });

        return {
            wasabiPerps,
            debtController,
            maxApy,
            maxLeverage,
            feeValue,
            owner,
            user1,
            publicClient,
        };
    }

    describe("Deployment", function () {
        it("Should set the right debt controller", async function () {
            const { wasabiPerps, debtController } = await loadFixture(deployWasabiPerps);
            expect(await wasabiPerps.read.debtController()).to.equal(getAddress(debtController.address));
        });

        it("Should set the right feeValue", async function () {
            const { wasabiPerps, feeValue } = await loadFixture(deployWasabiPerps);
            expect(await wasabiPerps.read.feeValue()).to.equal(feeValue);
        });

        it("Should set the right owner", async function () {
            const { wasabiPerps, owner } = await loadFixture(deployWasabiPerps);
            expect(await wasabiPerps.read.owner()).to.equal(getAddress(owner.account.address));
        });
    });

    describe("Trading", function () {
        it("Open Position", async function () {
            const { wasabiPerps, feeValue, uPPG, user1, openPositionRequest, downPayment, signature } = await loadFixture(deployMockEnvironment);

            await wasabiPerps.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account });

            const events = await wasabiPerps.getEvents.OpenPosition();
            expect(events).to.have.lengthOf(1);
            expect(events[0].args.positionId).to.equal(openPositionRequest.id);
            expect(events[0].args.downPayment).to.equal(getValueWithoutFee(downPayment, feeValue));
            expect(events[0].args.collateralAmount).to.equal(await uPPG.read.balanceOf([wasabiPerps.address]));
        });

        it("Close Position", async function () {
            const { publicClient, wasabiPerps, user1, feeValue, uPPG, mockSwap, openPositionRequest, downPayment, signature } = await loadFixture(deployMockEnvironment);
            await wasabiPerps.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account });

            const openPositionEvent = (await wasabiPerps.getEvents.OpenPosition())[0];
            const position: Position = await getEventPosition(openPositionEvent)
            const closePositionRequest: ClosePositionRequest = {
                position,
                functionCallDataList: [
                    getERC20ApproveFunctionCallData(uPPG.address, mockSwap.address, position.collateralAmount),
                    {
                        to: mockSwap.address,
                        value: 0n,
                        data: encodeFunctionData({
                            abi: [mockSwap.abi.find(a => a.type === "function" && a.name === "swap")!],
                            functionName: "swap",
                            args: [uPPG.address, position.collateralAmount, zeroAddress]
                        })
                    }
                ]
            };
            const poolBalanceBefore = await publicClient.getBalance({address: wasabiPerps.address });
            await wasabiPerps.write.closePosition([closePositionRequest], { account: user1.account });
            const poolBalanceAfter = await publicClient.getBalance({address: wasabiPerps.address });

            const positionDuration = BigInt(await time.latest()) - position.lastFundingTimestamp;

            const events = await wasabiPerps.getEvents.ClosePosition();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0];
            expect(closePositionEvent.args.id).to.equal(position.id);
            expect(closePositionEvent.args.repayAmount! + poolBalanceBefore).to.equal(poolBalanceAfter);
            expect(poolBalanceAfter).to.equal(poolBalanceBefore + position.principal + closePositionEvent.args.feeAmount!);
        });
    });

})
