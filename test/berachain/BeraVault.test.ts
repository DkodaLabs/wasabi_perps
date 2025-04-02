import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import hre from "hardhat";
import { expect } from "chai";
import { parseEther, zeroAddress, maxUint256, getAddress } from "viem";
import { deployLongPoolMockEnvironment, validatorPubKey } from "./berachainFixtures";
import { getBalance, takeBalanceSnapshot } from "../utils/StateUtils";
import { PayoutType } from "../utils/PerpStructUtils";
import { checkDepositEvents, checkMigrateTransferEvents, checkWithdrawEvents, distributeRewards, splitSharesWithFee } from "./berachainHelpers";

describe("BeraVault", function () {
    describe("Deployment", function () {
        it("Should deploy BeraVault correctly", async function () {
            const { vault, rewardVault, infraredVault, bgt } = await loadFixture(deployLongPoolMockEnvironment);
            expect(vault.address).to.not.equal(zeroAddress);
            expect(await vault.read.getRewardVault()).to.equal(rewardVault.address);
            expect(await vault.read.getInfraredVault()).to.equal(infraredVault.address);
            expect(await rewardVault.read.stakeToken()).to.equal(vault.address);
            expect(await rewardVault.read.rewardToken()).to.equal(bgt.address);
            expect(await vault.read.allowance([vault.address, infraredVault.address])).to.equal(maxUint256);
        });
    });

    describe("Deposit and withdraw", function () {
        it("Should deposit and stake fees in RewardVault", async function () {
            const { vault, rewardVault, wbera, user1, publicClient } = await loadFixture(deployLongPoolMockEnvironment);

            const amount = parseEther("100");
            await wbera.write.deposit({ value: amount, account: user1.account });
            await wbera.write.approve([vault.address, amount], { account: user1.account });

            const wberaBalancesBefore = await takeBalanceSnapshot(publicClient, wbera.address, user1.account.address, vault.address);
            const vaultSharesBefore = await takeBalanceSnapshot(publicClient, vault.address, user1.account.address, vault.address, rewardVault.address);

            await vault.write.deposit([amount, user1.account.address], { account: user1.account });

            const wberaBalancesAfter = await takeBalanceSnapshot(publicClient, wbera.address, user1.account.address, vault.address);
            const vaultSharesAfter = await takeBalanceSnapshot(publicClient, vault.address, user1.account.address, vault.address, rewardVault.address);
            const { sharesMinusFee, rewardFee } = await splitSharesWithFee(hre, vault.address, amount);

            expect(wberaBalancesBefore.get(user1.account.address) - amount).to.equal(wberaBalancesAfter.get(user1.account.address));
            expect(wberaBalancesBefore.get(vault.address) + amount).to.equal(wberaBalancesAfter.get(vault.address));
            expect(vaultSharesBefore.get(user1.account.address) + sharesMinusFee).to.equal(vaultSharesAfter.get(user1.account.address));
            expect(vaultSharesBefore.get(rewardVault.address) + rewardFee).to.equal(vaultSharesAfter.get(rewardVault.address));
            expect(vaultSharesAfter.get(vault.address)).to.equal(0n);

            await checkDepositEvents(hre, vault.address, user1.account.address, amount);
        });

        it("Should unstake fees and withdraw", async function () {
            const { vault, wbera, owner, publicClient } = await loadFixture(deployLongPoolMockEnvironment);

            // Owner already deposited in fixture
            const depositAmount = await vault.read.cumulativeBalanceOf([owner.account.address]);
            const wberaBalancesBefore = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address, vault.address);

            await vault.write.withdraw([depositAmount, owner.account.address, owner.account.address], { account: owner.account });

            const wberaBalancesAfter = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address, vault.address);
            const userSharesAfter = await vault.read.cumulativeBalanceOf([owner.account.address]);

            expect(wberaBalancesBefore.get(owner.account.address) + depositAmount).to.equal(wberaBalancesAfter.get(owner.account.address));
            expect(wberaBalancesBefore.get(vault.address) - depositAmount).to.equal(wberaBalancesAfter.get(vault.address));
            expect(userSharesAfter).to.equal(0);

            await checkWithdrawEvents(hre, vault.address, owner.account.address, depositAmount, depositAmount);
        });

        it("Should partially unstake fees and withdraw", async function () {
            const { vault, wbera, owner, publicClient } = await loadFixture(deployLongPoolMockEnvironment);

            // Owner already deposited in fixture
            const depositAmount = await vault.read.cumulativeBalanceOf([owner.account.address]);
            const withdrawAmount = depositAmount / 7n;
            const expectedShares = await vault.read.previewWithdraw([withdrawAmount]);
            const wberaBalancesBefore = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address, vault.address);
            
            await vault.write.withdraw([withdrawAmount, owner.account.address, owner.account.address], { account: owner.account });

            const wberaBalancesAfter = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address, vault.address);
            const userSharesAfter = await vault.read.cumulativeBalanceOf([owner.account.address]);

            expect(wberaBalancesBefore.get(owner.account.address) + withdrawAmount).to.equal(wberaBalancesAfter.get(owner.account.address));
            expect(wberaBalancesBefore.get(vault.address) - withdrawAmount).to.equal(wberaBalancesAfter.get(vault.address));
            expect(userSharesAfter).to.equal(depositAmount - withdrawAmount);

            await checkWithdrawEvents(hre, vault.address, owner.account.address, withdrawAmount, expectedShares);

            // Withdraw the rest
            const expectedAssets = await vault.read.previewRedeem([userSharesAfter]);

            await vault.write.withdraw([userSharesAfter, owner.account.address, owner.account.address], { account: owner.account });

            const finalWethBalances = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address, vault.address);
            const userSharesFinal = await vault.read.cumulativeBalanceOf([owner.account.address]);

            expect(wberaBalancesAfter.get(owner.account.address) + userSharesAfter).to.equal(finalWethBalances.get(owner.account.address));
            expect(wberaBalancesAfter.get(vault.address) - userSharesAfter).to.equal(finalWethBalances.get(vault.address));
            expect(userSharesFinal).to.equal(0);

            await checkWithdrawEvents(hre, vault.address, owner.account.address, expectedAssets, userSharesAfter);
        });
    });
});