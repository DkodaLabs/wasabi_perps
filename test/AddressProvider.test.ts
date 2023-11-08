import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { deployAddressProvider, deployDebtController, deployFeeController } from "./fixtures";
import { getAddress, parseEther, zeroAddress } from "viem";

describe("AddressProvider", function () {
    describe("Deployment", function () {
        it("Should set the right fee controller", async function () {
            const { addressProvider, feeController } = await loadFixture(deployAddressProvider);
            expect(await addressProvider.read.getFeeController()).to.equal(getAddress(feeController.address));
        });

        it("Should set the right debt controller", async function () {
            const { addressProvider, debtController } = await loadFixture(deployAddressProvider);
            expect(await addressProvider.read.getDebtController()).to.equal(getAddress(debtController.address));
        });

        it("Should set the right owner", async function () {
            const { addressProvider, owner } = await loadFixture(deployAddressProvider);
            expect(await addressProvider.read.owner()).to.equal(getAddress(owner.account.address));
        });
    });

    describe("Set addresses", function () {
        it("Should set the right fee controller correctly", async function () {
            const { addressProvider, owner } = await loadFixture(deployAddressProvider);
            const { feeController } = await loadFixture(deployFeeController);

            await addressProvider.write.setFeeController([getAddress(feeController.address)], { account: owner.account });
            expect(await addressProvider.read.getFeeController()).to.equal(getAddress(feeController.address));
        });

        it("Should set the debt controller correctly", async function () {
            const { addressProvider, owner } = await loadFixture(deployAddressProvider);
            const { debtController } = await loadFixture(deployDebtController);

            await addressProvider.write.setDebtController([getAddress(debtController.address)], { account: owner.account });
            expect(await addressProvider.read.getDebtController()).to.equal(getAddress(debtController.address));
        });

        it("Only owner can set controllers", async function () {
            const { addressProvider, user1 } = await loadFixture(deployAddressProvider);

            const { feeController } = await loadFixture(deployFeeController);
            const { debtController } = await loadFixture(deployDebtController);

            await expect(addressProvider.write.setDebtController([getAddress(debtController.address)], { account: user1.account }))
                .to.be.rejectedWith(`OwnableUnauthorizedAccount("${getAddress(user1.account.address)}")`, "Only owner can call this function");

            await expect(addressProvider.write.setFeeController([getAddress(feeController.address)], { account: user1.account }))
                .to.be.rejectedWith(`OwnableUnauthorizedAccount("${getAddress(user1.account.address)}")`, "Only owner can call this function");
        });
    });
});