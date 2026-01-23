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

const MIN_DURATION = 86400n * 14n; // 14 days
const ONE_DAY = 86400n;

describe("VaultBoostManager", function () {
    describe("Vault Boosts", function () {
        it("Should initiate a vault boost", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const amount = parseEther("1");
            const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // 1 day from now
            await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
            await vaultBoostManager.write.initiateBoost(
                [weth.address, amount, startTimestamp, MIN_DURATION], 
                { account: owner.account }
            );

            const boost = await vaultBoostManager.read.boostsByToken([weth.address, 0n]);
            expect(boost[0]).to.equal(wethVault.address);
            expect(boost[1]).to.equal(getAddress(owner.account.address));
            expect(boost[2]).to.equal(BigInt(await time.latest()));
            expect(boost[3]).to.equal(startTimestamp);
            expect(boost[4]).to.equal(startTimestamp + MIN_DURATION);
            expect(boost[5]).to.equal(0n);
            expect(boost[6]).to.equal(amount);

            const boostEvents = await vaultBoostManager.getEvents.VaultBoostInitiated();
            expect(boostEvents.length).to.equal(1);

            const boosts = await vaultBoostManager.read.getBoosts([weth.address]);
            expect(boosts.length).to.equal(1);
        });

        it("Should pay a vault boost in full", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const amount = parseEther("1");
            const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
            await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
            await vaultBoostManager.write.initiateBoost(
                [weth.address, amount, startTimestamp, MIN_DURATION], 
                { account: owner.account }
            );

            await time.increase(MIN_DURATION + ONE_DAY); // 15 days from now

            const sharePriceBefore = await wethVault.read.convertToAssets([amount]);

            await vaultBoostManager.write.payBoosts([weth.address], { account: owner.account });
            const timestamp = await time.latest();

            const boost = await vaultBoostManager.read.boostsByToken([weth.address, 0n]);
            expect(boost[5]).to.equal(timestamp);
            expect(boost[6]).to.equal(0n);

            const sharePriceAfter = await wethVault.read.convertToAssets([amount]);
            expect(sharePriceAfter).to.be.gt(sharePriceBefore);
        });

        it("Should pay half of a boost when the boost is halfway through", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const amount = parseEther("1");
            const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
            await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
            await vaultBoostManager.write.initiateBoost(
                [weth.address, amount, startTimestamp, MIN_DURATION * 2n], // 28 days duration
                { account: owner.account }
            );

            await time.increaseTo(startTimestamp + MIN_DURATION - 1n); // Boost is halfway through

            await vaultBoostManager.write.payBoosts([weth.address], { account: owner.account });

            const boost = await vaultBoostManager.read.boostsByToken([weth.address, 0n]);
            expect(boost[6]).to.equal(amount / 2n);
        });

        it("Should not pay a boost if it is not started yet", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const amount = parseEther("1");
            const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
            await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
            await vaultBoostManager.write.initiateBoost(
                [weth.address, amount, startTimestamp, MIN_DURATION], 
                { account: owner.account }
            );

            await vaultBoostManager.write.payBoosts([weth.address], { account: owner.account });

            const boost = await vaultBoostManager.read.boostsByToken([weth.address, 0n]);
            expect(boost[6]).to.equal(amount);
        });

        it("Should not pay a boost at the start of the boost", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const amount = parseEther("1");
            const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
            await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
            await vaultBoostManager.write.initiateBoost(
                [weth.address, amount, startTimestamp, MIN_DURATION], 
                { account: owner.account }
            );

            await time.increaseTo(startTimestamp - 1n); // Boost will start in the next block
            await vaultBoostManager.write.payBoosts([weth.address], { account: owner.account });

            const boost = await vaultBoostManager.read.boostsByToken([weth.address, 0n]);
            expect(boost[6]).to.equal(amount);
        });

        it("Should not pay a boost again if there is no meaningful amount to distribute", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            // Boost with a very small amount to cause division rounding to 0 after the first payment
            const amount = parseEther("0.0000000000001"); 
            const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
            await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
            await vaultBoostManager.write.initiateBoost(
                [weth.address, amount, startTimestamp, MIN_DURATION * 2n], // 28 days duration
                { account: owner.account }
            );

            await time.increaseTo(startTimestamp + MIN_DURATION - 1n); // Boost is halfway through

            // First payment should be successful, will pay 0.00000000000005 ETH
            await vaultBoostManager.write.payBoosts([weth.address], { account: owner.account });

            let boost = await vaultBoostManager.read.boostsByToken([weth.address, 0n]);
            expect(boost[6]).to.equal(amount / 2n);

            // Second payment attempt should be skipped as there is no meaningful amount to distribute
            await vaultBoostManager.write.payBoosts([weth.address], { account: owner.account });

            boost = await vaultBoostManager.read.boostsByToken([weth.address, 0n]);
            expect(boost[6]).to.equal(amount / 2n);
        });

        it("Should cancel a vault boost", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const amount = parseEther("1");
            const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
            await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });

            const wethBalanceBeforeBoost = await weth.read.balanceOf([owner.account.address]);

            await vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, MIN_DURATION], { account: owner.account });

            await vaultBoostManager.write.cancelBoost([weth.address, 0n], { account: owner.account });

            // Verify the boost was removed from the array
            const boosts = await vaultBoostManager.read.getBoosts([weth.address]);
            expect(boosts.length).to.equal(0);

            const boostEvents = await vaultBoostManager.getEvents.VaultBoostCancelled();
            expect(boostEvents.length).to.equal(1);
            const boostEvent = boostEvents[0].args;
            expect(boostEvent.vault).to.equal(getAddress(wethVault.address));
            expect(boostEvent.token).to.equal(getAddress(weth.address));
            expect(boostEvent.boostedBy).to.equal(getAddress(owner.account.address));
            expect(boostEvent.amountReturned).to.equal(amount);

            const wethBalanceAfterCancel = await weth.read.balanceOf([owner.account.address]);
            expect(wethBalanceAfterCancel).to.equal(wethBalanceBeforeBoost);
        });

        it("Should not pay a vault boost if it was cancelled", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const amount = parseEther("1");
            const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
            await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
            await vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, MIN_DURATION], { account: owner.account });

            // Cancel the boost
            await time.increase(ONE_DAY); // Boost starts
            await vaultBoostManager.write.cancelBoost([weth.address, 0n], { account: owner.account });

            // Try to pay the boost - should revert since the boost was removed
            await time.increase(MIN_DURATION); // Boost ends
            await expect(vaultBoostManager.write.payBoosts([weth.address], { account: owner.account })).to.be.rejectedWith("BoostNotActive");
        });

        it("Should recover tokens sent directly to the contract", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const amount = parseEther("1");
            const wethBalanceBefore = await weth.read.balanceOf([owner.account.address]);

            // Transfer tokens to the contract instead of initiating a boost properly
            await weth.write.transfer([vaultBoostManager.address, amount], { account: owner.account });

            // Recover the tokens
            await vaultBoostManager.write.recoverTokens([weth.address, owner.account.address, amount], { account: owner.account });

            const wethBalanceAfter = await weth.read.balanceOf([owner.account.address]);
            expect(wethBalanceAfter).to.equal(wethBalanceBefore);
        });

        it("Should replace the first completed boost when initiating a new boost", async function () {
            const { vaultBoostManager, weth, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const amount = parseEther("1");
            const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now

            // Initiate the first boost
            await weth.write.approve([vaultBoostManager.address, amount * 3n], { account: owner.account });
            await vaultBoostManager.write.initiateBoost(
                [weth.address, amount, startTimestamp, MIN_DURATION],
                { account: owner.account }
            );

            // Initiate a second boost
            await vaultBoostManager.write.initiateBoost(
                [weth.address, amount, startTimestamp, MIN_DURATION],
                { account: owner.account }
            );

            let boosts = await vaultBoostManager.read.getBoosts([weth.address]);
            expect(boosts.length).to.equal(2);

            // Complete the first boost by paying it in full
            await time.increase(MIN_DURATION + ONE_DAY);
            await vaultBoostManager.write.payBoosts([weth.address], { account: owner.account });

            // Verify the first boost is completed
            const completedBoost = await vaultBoostManager.read.boostsByToken([weth.address, 0n]);
            expect(completedBoost[6]).to.equal(0n); // amountRemaining == 0

            // Initiate a third boost - should replace the first completed boost at index 0
            const newStartTimestamp = BigInt(await time.latest()) + ONE_DAY;
            await vaultBoostManager.write.initiateBoost(
                [weth.address, amount, newStartTimestamp, MIN_DURATION],
                { account: owner.account }
            );

            // Verify the boosts array length is still 2 (replaced, not appended)
            boosts = await vaultBoostManager.read.getBoosts([weth.address]);
            expect(boosts.length).to.equal(2);

            // Verify the first boost was replaced with the new one
            const replacedBoost = await vaultBoostManager.read.boostsByToken([weth.address, 0n]);
            expect(replacedBoost[3]).to.equal(newStartTimestamp); // startTimestamp matches new boost
            expect(replacedBoost[6]).to.equal(amount); // amountRemaining is the new amount
        });
    });

    describe("Validations", function () {
        it("Only admin can upgrade the contract", async function () {
            const { vaultBoostManager, user1, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const implementationAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(vaultBoostManager.address));
            await expect(vaultBoostManager.write.upgradeToAndCall(
                [implementationAddress, "0x"], 
                { account: user1.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");

            await expect(vaultBoostManager.write.upgradeToAndCall(
                [implementationAddress, "0x"], 
                { account: owner.account }
            )).to.be.fulfilled;
        });

        describe("Initiate Boost", function () {
            it("Should revert if the duration is less than the minimum duration", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await expect(vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, MIN_DURATION - 1n], { account: owner.account })).to.be.rejectedWith("InvalidBoostDuration");
            });

            it("Should revert if the amount is 0", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await expect(vaultBoostManager.write.initiateBoost([weth.address, 0n, startTimestamp, MIN_DURATION], { account: owner.account })).to.be.rejectedWith("InvalidBoostAmount");
            });

            it("Should revert if the start timestamp is in the past", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) - ONE_DAY; // Starts 1 day ago
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await expect(vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, MIN_DURATION], { account: owner.account })).to.be.rejectedWith("InvalidBoostStartTimestamp");
            });

            it("Should revert if the vault is not found", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await expect(vaultBoostManager.write.initiateBoost(
                    ["0x1234567890123456789012345678901234567890", amount, startTimestamp, MIN_DURATION],
                    { account: owner.account }
                )).to.be.rejectedWith("InvalidVault");
            });

            it("Should revert if there are too many active boosts", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now

                // Approve enough for 5 boosts
                await weth.write.approve([vaultBoostManager.address, amount * 5n], { account: owner.account });

                // Initiate 4 boosts (the maximum allowed)
                for (let i = 0; i < 4; i++) {
                    await vaultBoostManager.write.initiateBoost(
                        [weth.address, amount, startTimestamp, MIN_DURATION],
                        { account: owner.account }
                    );
                }

                const boosts = await vaultBoostManager.read.getBoosts([weth.address]);
                expect(boosts.length).to.equal(4);

                // Attempting to initiate a 5th boost should revert
                await expect(vaultBoostManager.write.initiateBoost(
                    [weth.address, amount, startTimestamp, MIN_DURATION],
                    { account: owner.account }
                )).to.be.rejectedWith("TooManyActiveBoosts");
            });
        });

        describe("Pay Boosts", function () {
            it("Only admin can pay boosts", async function () {
                const { vaultBoostManager, weth, user1 } = await loadFixture(deployShortPoolMockEnvironment);

                await expect(vaultBoostManager.write.payBoosts(
                    [weth.address], 
                    { account: user1.account }
                )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");
            });

            it("Should revert if the boost is not created", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await expect(vaultBoostManager.write.payBoosts([weth.address], { account: owner.account })).to.be.rejectedWith("BoostNotActive");
            });
        });

        describe("Cancel Boost", function () {
            it("Only admin can cancel boosts", async function () {
                const { vaultBoostManager, weth, user1 } = await loadFixture(deployShortPoolMockEnvironment);

                await expect(vaultBoostManager.write.cancelBoost([weth.address, 0n], { account: user1.account })).to.be.rejectedWith("AccessManagerUnauthorizedAccount");
            });

            it("Should revert if the boost is not created", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await expect(vaultBoostManager.write.cancelBoost(
                    [weth.address, 0n], 
                    { account: owner.account }
                )).to.be.rejectedWith("InvalidBoostIndex");
            });

            it("Should revert if the boost is not active", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });

                await vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, MIN_DURATION], { account: owner.account });

                await time.increase(MIN_DURATION + ONE_DAY); // 15 days from now, boost is ended
                await vaultBoostManager.write.payBoosts([weth.address], { account: owner.account });
                
                await expect(vaultBoostManager.write.cancelBoost([weth.address, 0n], { account: owner.account })).to.be.rejectedWith("BoostNotActive");
            });
        });

        describe("Recover Tokens", function () {
            it("Only admin can recover tokens", async function () {
                const { vaultBoostManager, weth, user1 } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                await expect(vaultBoostManager.write.recoverTokens(
                    [weth.address, user1.account.address, amount], 
                    { account: user1.account }
                )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");
            });

            it("Should revert if the amount is greater than the balance", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                // No boost active, so the boost manager will have no token balance
                await expect(vaultBoostManager.write.recoverTokens(
                    [weth.address, owner.account.address, amount], 
                    { account: owner.account }
                )).to.be.rejectedWith("InsufficientTokenBalance");
            });

            it("Should revert if the tokens are part of an active boost", async function () {
                const { vaultBoostManager, weth, owner } = await loadFixture(deployShortPoolMockEnvironment);

                const amount = parseEther("1");
                const startTimestamp = BigInt(await time.latest()) + ONE_DAY; // Starts 1 day from now
                await weth.write.approve([vaultBoostManager.address, amount], { account: owner.account });
                await vaultBoostManager.write.initiateBoost([weth.address, amount, startTimestamp, MIN_DURATION], { account: owner.account });

                // All the tokens held by the boost manager are committed to boosts, so there is no balance left to recover
                await expect(vaultBoostManager.write.recoverTokens(
                    [weth.address, owner.account.address, amount], 
                    { account: owner.account }
                )).to.be.rejectedWith("InsufficientTokenBalance");
            });
        });
    });
});