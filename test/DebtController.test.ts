import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { getAddress, parseEther, zeroAddress } from "viem";
import { deployLongPoolMockEnvironment, deployPerpManager } from "./fixtures";

describe("DebtController", function () {

    describe("Deployment", function () {
        it("Should set the right maxApy", async function () {
            const { manager, maxApy } = await loadFixture(deployPerpManager);
            expect(await manager.read.maxApy()).to.equal(maxApy);
        });
    });

    describe("Calculations", function () {
        it("Compute max principal", async function () {
            const { manager, maxLeverage, weth, usdc } = await loadFixture(deployLongPoolMockEnvironment);

            const downPayment = parseEther("1").valueOf();
            const maxPrincipal = downPayment * (maxLeverage - 100n) / 100n;

            expect(await manager.read.computeMaxPrincipal([weth.address, usdc.address, downPayment])).to.equal(maxPrincipal);
        });

        it("Compute max principal with custom max leverage", async function () {
            const { manager, weth, usdc } = await loadFixture(deployLongPoolMockEnvironment);

            const maxLeverage = 1000n;
            await manager.write.setMaxLeverage([weth.address, usdc.address, maxLeverage]);

            const downPayment = parseEther("1").valueOf();
            const maxPrincipal = downPayment * (maxLeverage - 100n) / 100n;

            expect(await manager.read.computeMaxPrincipal([weth.address, usdc.address, downPayment])).to.equal(maxPrincipal);

            await manager.read.checkMaxLeverage([downPayment, maxPrincipal + downPayment, weth.address, usdc.address]);

            await expect(manager.read.checkMaxLeverage([downPayment, maxPrincipal + downPayment + 1n, weth.address, usdc.address])).to.be.rejectedWith("PrincipalTooHigh");
        });

        it("Compute max interest", async function () {
            const { manager, maxApy } = await loadFixture(deployPerpManager);
            const lastFundingTimestamp = BigInt(await time.latest());

            const numSecondsInYear = 365n * 24n * 60n * 60n;
            const fullCyclePaymentTimestamp = lastFundingTimestamp + numSecondsInYear;
            await time.increaseTo(fullCyclePaymentTimestamp);

            const principal = parseEther("1").valueOf();
            const maxInterest = principal * maxApy / 100n;

            expect(await manager.read.computeMaxInterest([zeroAddress, principal, lastFundingTimestamp])).to.equal(maxInterest);
        });
    });
})
