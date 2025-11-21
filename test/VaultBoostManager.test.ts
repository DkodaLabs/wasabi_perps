import {
    loadFixture,
    time,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { deployShortPoolMockEnvironment } from "./fixtures";
import { signClosePositionRequest } from "./utils/SigningUtils";
import { takeBalanceSnapshot } from "./utils/StateUtils";
import { ClosePositionRequest, FunctionCallData, PayoutType } from "./utils/PerpStructUtils";
import { getAddress, parseEther, parseUnits, zeroAddress } from "viem";

describe("VaultBoostManager", function () {
    describe("Vault Boosts", function () {
        it("Should initiate a vault boost", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const amount = parseEther("1");
            const startTimestamp = BigInt(await time.latest()) + 86400n; // 1 day from now
            await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
            await vaultBoostManager.write.initiateBoost(
                [weth.address, amount, startTimestamp, 86400n], 
                { account: owner.account }
            );

            const boost = await vaultBoostManager.read.boosts([weth.address]);
            expect(boost[0]).to.equal(wethVault.address);
            expect(boost[1]).to.equal(startTimestamp);
            expect(boost[2]).to.equal(startTimestamp + 86400n);
            expect(boost[3]).to.equal(0n);
            expect(boost[4]).to.equal(amount);

            const boostEvents = await vaultBoostManager.getEvents.VaultBoostInitiated();
            expect(boostEvents.length).to.equal(1);
        });

        it("Should pay a vault boost in full", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const amount = parseEther("1");
            const startTimestamp = BigInt(await time.latest()) + 86400n; // Starts 1 day from now
            await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
            await vaultBoostManager.write.initiateBoost(
                [weth.address, amount, startTimestamp, 86400n], 
                { account: owner.account }
            );

            await time.increase(86400n * 2n); // 2 days from now

            const sharePriceBefore = await wethVault.read.convertToAssets([amount]);

            await vaultBoostManager.write.payBoost([weth.address], { account: owner.account });
            const timestamp = await time.latest();

            const boost = await vaultBoostManager.read.boosts([weth.address]);
            expect(boost[3]).to.equal(timestamp);
            expect(boost[4]).to.equal(0n);

            const boostEvents = await vaultBoostManager.getEvents.VaultBoostPayment();
            expect(boostEvents.length).to.equal(1);
            const boostEvent = boostEvents[0].args;
            expect(boostEvent.vault).to.equal(getAddress(wethVault.address));
            expect(boostEvent.token).to.equal(getAddress(weth.address));
            expect(boostEvent.amount).to.equal(amount);

            const sharePriceAfter = await wethVault.read.convertToAssets([amount]);
            expect(sharePriceAfter).to.be.gt(sharePriceBefore);
        });
    });

    describe("Validations", function () {
        describe("Initiate Boost", function () {
            it("Should revert if the duration is less than the minimum duration", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + 86400n; // Starts 1 day from now
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await expect(vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, 86399n], { account: owner.account })).to.be.rejectedWith("InvalidBoostDuration");
            });

            it("Should revert if the amount is 0", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + 86400n; // Starts 1 day from now
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await expect(vaultBoostManager.write.initiateBoost([weth.address, 0n, startTimestamp, 86400n], { account: owner.account })).to.be.rejectedWith("InvalidBoostAmount");
            });

            it("Should revert if the start timestamp is in the past", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) - 86400n; // Starts 1 day ago
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await expect(vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, 86400n], { account: owner.account })).to.be.rejectedWith("InvalidBoostStartTimestamp");
            });

            it("Should revert if the boost is already active", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + 86400n; // Starts 1 day from now
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, 86400n], { account: owner.account });
                await expect(vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, 86400n], { account: owner.account })).to.be.rejectedWith("BoostAlreadyActive");
            });

            it("Should revert if the vault is not found", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + 86400n; // Starts 1 day from now
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await expect(vaultBoostManager.write.initiateBoost(
                    ["0x1234567890123456789012345678901234567890", amount, startTimestamp, 86400n], 
                    { account: owner.account }
                )).to.be.rejectedWith("InvalidVault");
            });
        });

        describe("Pay Boost", function () {
            it("Should revert if the boost is not created", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await expect(vaultBoostManager.write.payBoost([weth.address], { account: owner.account })).to.be.rejectedWith("BoostNotActive");
            });

            it("Should revert if the boost is not started yet", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + 86400n; // Starts 1 day from now
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, 86400n], { account: owner.account });
                await expect(vaultBoostManager.write.payBoost([weth.address], { account: owner.account })).to.be.rejectedWith("BoostNotActive");
            });

            it("Should revert if the boost is already ended and paid out", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + 86400n; // Starts 1 day from now
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, 86400n], { account: owner.account });

                await time.increase(86400n * 2n); // 2 days from now
                await vaultBoostManager.write.payBoost([weth.address], { account: owner.account });

                await time.increase(86400n); // 1 day from now
                await expect(vaultBoostManager.write.payBoost([weth.address], { account: owner.account })).to.be.rejectedWith("BoostNotActive");
            });
        });
    });
});