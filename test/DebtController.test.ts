import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { getAddress, parseEther, zeroAddress } from "viem";
import { deployPerpManager } from "./fixtures";

describe("DebtController", function () {

    describe("Deployment", function () {
        it("Should set the right maxApy", async function () {
            const { manager, maxApy } = await loadFixture(deployPerpManager);
            expect(await manager.read.maxApy()).to.equal(maxApy);
        });

        it("Should set the right maxLeverage", async function () {
            const { manager, maxLeverage } = await loadFixture(deployPerpManager);
            expect(await manager.read.maxLeverage()).to.equal(maxLeverage);
        });
    });

    describe("Calculations", function () {
        it("Compute max principal", async function () {
            const { manager, maxLeverage } = await loadFixture(deployPerpManager);

            const downPayment = parseEther("1").valueOf();
            const maxPrincipal = downPayment * (maxLeverage - 100n) / 100n;

            expect(await manager.read.computeMaxPrincipal([zeroAddress, zeroAddress, downPayment])).to.equal(maxPrincipal);
        });

        it("Compute max debt", async function () {
            const { manager, maxApy } = await loadFixture(deployPerpManager);
            const lastFundingTimestamp = BigInt(await time.latest());

            const numSecondsInYear = 365n * 24n * 60n * 60n;
            const fullCyclePaymentTimestamp = lastFundingTimestamp + numSecondsInYear;
            await time.increaseTo(fullCyclePaymentTimestamp);

            const principal = parseEther("1").valueOf();
            const maxDebt = principal * maxApy / 100n;

            expect(await manager.read.computeMaxInterest([zeroAddress, principal, lastFundingTimestamp])).to.equal(maxDebt);
        });
    });
})
