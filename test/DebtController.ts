import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseGwei, parseEther, zeroAddress } from "viem";

describe("DebtController", function () {

    async function deployDebtController() {
        const maxApy = 300n; // 300% APY
        const maxLeverage = 500n; // 5x Leverage

        // Contracts are deployed using the first signer/account by default
        const [owner, otherAccount] = await hre.viem.getWalletClients();
        const debtController = await hre.viem.deployContract("DebtController", [maxApy, maxLeverage]);
        const publicClient = await hre.viem.getPublicClient();

        return {
            debtController,
            maxApy,
            maxLeverage,
            owner,
            otherAccount,
            publicClient,
        };
    }

    describe("Deployment", function () {
        it("Should set the right maxApy", async function () {
            const { debtController, maxApy } = await loadFixture(deployDebtController);
            expect(await debtController.read.maxApy()).to.equal(maxApy);
        });

        it("Should set the right maxLeverage", async function () {
            const { debtController, maxLeverage } = await loadFixture(deployDebtController);
            expect(await debtController.read.maxLeverage()).to.equal(maxLeverage);
        });

        it("Should set the right owner", async function () {
            const { debtController, owner } = await loadFixture(deployDebtController);
            expect(await debtController.read.owner()).to.equal(getAddress(owner.account.address));
        });
    });

    describe("Calculations", function () {
        it("Compute max principal", async function () {
            const { debtController, maxLeverage } = await loadFixture(deployDebtController);

            const downPayment = parseEther("1").valueOf();
            const maxPrincipal = downPayment * (maxLeverage - 100n) / 100n;

            expect(await debtController.read.computeMaxPrincipal([zeroAddress, zeroAddress, downPayment])).to.equal(maxPrincipal);
        });

        it("Compute max debt", async function () {
            const { debtController, maxApy } = await loadFixture(deployDebtController);
            const lastFundingTimestamp = BigInt(await time.latest());

            const numSecondsInYear = 365n * 24n * 60n * 60n;
            const fullCyclePaymentTimestamp = lastFundingTimestamp + numSecondsInYear;
            await time.increaseTo(fullCyclePaymentTimestamp);

            const principal = parseEther("1").valueOf();
            const maxDebt = principal * (maxApy + 100n) / 100n;

            expect(await debtController.read.computeMaxDebt([zeroAddress, zeroAddress, principal, lastFundingTimestamp])).to.equal(maxDebt);
        });
    });
})
