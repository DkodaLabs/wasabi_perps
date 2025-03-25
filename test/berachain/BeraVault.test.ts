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
            const { vault, rewardVault, bgt } = await loadFixture(deployLongPoolMockEnvironment);
            expect(vault.address).to.not.equal(zeroAddress);
            expect(await vault.read.rewardVault()).to.equal(rewardVault.address);
            expect(await rewardVault.read.stakeToken()).to.equal(vault.address);
            expect(await rewardVault.read.rewardToken()).to.equal(bgt.address);
            expect(await vault.read.allowance([vault.address, rewardVault.address])).to.equal(maxUint256);
        });
    });

    describe("Deposit and withdraw", function () {
        it("Should deposit and stake in RewardVault", async function () {
            const { vault, wbera, user1, publicClient } = await loadFixture(deployLongPoolMockEnvironment);

            const amount = parseEther("100");
            await wbera.write.deposit({ value: amount, account: user1.account });
            await wbera.write.approve([vault.address, amount], { account: user1.account });

            const wberaBalancesBefore = await takeBalanceSnapshot(publicClient, wbera.address, user1.account.address, vault.address);

            await vault.write.deposit([amount, user1.account.address], { account: user1.account });

            const wberaBalancesAfter = await takeBalanceSnapshot(publicClient, wbera.address, user1.account.address, vault.address);
            const userSharesAfter = await vault.read.balanceOf([user1.account.address]);

            expect(wberaBalancesBefore.get(user1.account.address) - amount).to.equal(wberaBalancesAfter.get(user1.account.address));
            expect(wberaBalancesBefore.get(vault.address) + amount).to.equal(wberaBalancesAfter.get(vault.address));
            expect(userSharesAfter).to.equal(amount);

            await checkDepositEvents(hre, vault.address, user1.account.address, amount);
        });

        it("Should unstake and withdraw", async function () {
            const { vault, wbera, owner, publicClient } = await loadFixture(deployLongPoolMockEnvironment);

            // Owner already deposited in fixture
            const depositAmount = await vault.read.balanceOf([owner.account.address]);
            const wberaBalancesBefore = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address, vault.address);

            await vault.write.withdraw([depositAmount, owner.account.address, owner.account.address], { account: owner.account });

            const wberaBalancesAfter = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address, vault.address);
            const userSharesAfter = await vault.read.balanceOf([owner.account.address]);

            expect(wberaBalancesBefore.get(owner.account.address) + depositAmount).to.equal(wberaBalancesAfter.get(owner.account.address));
            expect(wberaBalancesBefore.get(vault.address) - depositAmount).to.equal(wberaBalancesAfter.get(vault.address));
            expect(userSharesAfter).to.equal(0);

            await checkWithdrawEvents(hre, vault.address, owner.account.address, depositAmount, depositAmount);
        });

        it("Should partially unstake and withdraw", async function () {
            const { vault, wbera, owner, publicClient } = await loadFixture(deployLongPoolMockEnvironment);

            // Owner already deposited in fixture
            const depositAmount = await vault.read.balanceOf([owner.account.address]);
            const withdrawAmount = depositAmount / 7n;
            const expectedShares = await vault.read.previewWithdraw([withdrawAmount]);
            const wberaBalancesBefore = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address, vault.address);
            
            await vault.write.withdraw([withdrawAmount, owner.account.address, owner.account.address], { account: owner.account });

            const wberaBalancesAfter = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address, vault.address);
            const userSharesAfter = await vault.read.balanceOf([owner.account.address]);

            expect(wberaBalancesBefore.get(owner.account.address) + withdrawAmount).to.equal(wberaBalancesAfter.get(owner.account.address));
            expect(wberaBalancesBefore.get(vault.address) - withdrawAmount).to.equal(wberaBalancesAfter.get(vault.address));
            expect(userSharesAfter).to.equal(depositAmount - withdrawAmount);

            await checkWithdrawEvents(hre, vault.address, owner.account.address, withdrawAmount, expectedShares);

            // Withdraw the rest
            const expectedAssets = await vault.read.previewRedeem([userSharesAfter]);

            await vault.write.withdraw([userSharesAfter, owner.account.address, owner.account.address], { account: owner.account });

            const finalWethBalances = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address, vault.address);
            const userSharesFinal = await vault.read.balanceOf([owner.account.address]);

            expect(wberaBalancesAfter.get(owner.account.address) + userSharesAfter).to.equal(finalWethBalances.get(owner.account.address));
            expect(wberaBalancesAfter.get(vault.address) - userSharesAfter).to.equal(finalWethBalances.get(vault.address));
            expect(userSharesFinal).to.equal(0);

            await checkWithdrawEvents(hre, vault.address, owner.account.address, expectedAssets, userSharesAfter);
        });

        it("Should earn interest and rewards", async function () {
            const {
                sendDefaultOpenPositionRequest,
                createSignedClosePositionRequest,
                wasabiLongPool,
                user1,
                owner,
                vault,
                rewardVault,
                bgt,
                distributor,
                publicClient,
                wbera,
            } = await loadFixture(deployLongPoolMockEnvironment);
            
            // Owner already deposited in fixture
            const depositAmount = await getBalance(publicClient, wbera.address, vault.address);
            const shares = await vault.read.balanceOf([owner.account.address]);

            // Deposit from user1 too
            await vault.write.depositEth([user1.account.address], { value: depositAmount, account: user1.account });

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Distribute rewards
            const rewardAmount = await distributeRewards(
                hre, distributor.address, bgt.address, rewardVault.address, owner.account, await time.latest()
            );
            const { sharesMinusFee: rewardMinusFee, rewardFee } = await splitSharesWithFee(hre, vault.address, rewardAmount);

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({ position });

            await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            // Checks
            const closeEvents = await wasabiLongPool.getEvents.PositionClosed();
            expect(closeEvents).to.have.lengthOf(1, "PositionClosed event not emitted");
            const closePositionEvent = closeEvents[0].args;
            const interest = closePositionEvent.interestPaid!;

            await time.increase(86400n * 7n); // 1 week later (enough time to vest all BGT rewards)

            const wberaBalancesBefore = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address);
            const bgtBalanceBefore = await getBalance(publicClient, bgt.address, owner.account.address);
            
            const withdrawAmount = await vault.read.previewRedeem([shares]);
            const hash =
                await vault.write.redeem([shares, owner.account.address, owner.account.address], { account: owner.account });
            // const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            // console.log("Redeem gas cost: ", formatEther(gasUsed));

            await checkWithdrawEvents(hre, vault.address, owner.account.address, withdrawAmount, shares);

            // Claim rewards
            await rewardVault.write.getReward([owner.account.address, owner.account.address], { account: owner.account });

            const vaultSharesAfter = await takeBalanceSnapshot(publicClient, vault.address, owner.account.address, vault.address);
            const wberaBalancesAfter = await takeBalanceSnapshot(publicClient, wbera.address, owner.account.address, vault.address);
            const bgtBalanceAfter = await getBalance(publicClient, bgt.address, owner.account.address);
            
            expect(wberaBalancesAfter.get(owner.account.address) - wberaBalancesBefore.get(owner.account.address)).to.equal(
                depositAmount + interest / 2n, "WBERA balance change does not match withdraw amount"
            );
            expect(bgtBalanceAfter - bgtBalanceBefore).to.be.approximately(
                rewardMinusFee / 2n, 25n, "BGT balance change does not match reward amount minus fee"
            );
            expect(vaultSharesAfter.get(owner.account.address)).to.equal(0n);

            // Now claim reward fee accrued to the vault
            await vault.write.claimBGTReward([owner.account.address], { account: owner.account });
            const finalBgtBalance = await getBalance(publicClient, bgt.address, owner.account.address);
            expect(finalBgtBalance - bgtBalanceAfter).to.be.approximately(
                rewardFee, 25n, "BGT balance change does not match reward fee"
            );
        });

        it("Should pay incentive for rewards", async function () {
            const {
                user1,
                owner,
                vault,
                rewardVault,
                distributor,
                wbera,
                bgt
            } = await loadFixture(deployLongPoolMockEnvironment);

            const amount = parseEther("100");
            await wbera.write.deposit({ value: amount, account: user1.account });
            await wbera.write.approve([vault.address, amount], { account: user1.account });

            // WBERA incentive added to RewardVault in fixture
            const minRate = parseEther("1");
            const rate = parseEther("10");

            // Incentive checks
            expect(await rewardVault.read.getWhitelistedTokensCount()).to.equal(1);
            const [ minIncentiveRate, incentiveRate, amountRemaining, manager ] = await rewardVault.read.incentives([wbera.address]);
            expect(minIncentiveRate).to.equal(minRate);
            expect(incentiveRate).to.equal(rate);
            expect(amountRemaining).to.equal(amount);
            expect(manager).to.equal(getAddress(owner.account.address));

            // Deposit
            await vault.write.deposit([amount, user1.account.address], { account: user1.account });

            await time.increase(86400n); // 1 day later

            const ownerWBERABalanceBefore = await wbera.read.balanceOf([owner.account.address]);

            // Distribute rewards
            const rewardAmount = await distributeRewards(
                hre, distributor.address, bgt.address, rewardVault.address, owner.account, await time.latest()
            );

            const ownerWBERABalanceAfter = await wbera.read.balanceOf([owner.account.address]);

            // Check that validator received incentive
            expect(ownerWBERABalanceAfter - ownerWBERABalanceBefore).to.equal(rewardAmount * 10n, "Owner did not receive incentive");
        });

        it("Should migrate reward fee for users who deposit before fee change", async function () {
            const { vault, rewardVault, wbera, bgt, distributor, user1, user2, owner, publicClient } = await loadFixture(deployLongPoolMockEnvironment);
            const feeReceiver = user2.account;
            
            // Set reward fee to 0
            await vault.write.setRewardFeeBips([0n], { account: owner.account });

            // Owner already deposited 20 WBERA in fixture, while reward fee was 5%
            // User deposits while the reward fee is 0%
            const amount = parseEther("80");
            await wbera.write.deposit({ value: amount, account: user1.account });
            await wbera.write.approve([vault.address, amount], { account: user1.account });
            await vault.write.deposit([amount, user1.account.address], { account: user1.account });

            await checkDepositEvents(hre, vault.address, user1.account.address, amount);

            expect(await rewardVault.read.balanceOf([user1.account.address])).to.equal(
                amount, "All of user's shares should be deposited on their behalf"
            );

            await time.increase(86400n); // 1 day later

            // Distribute rewards
            let rewardAmount = await distributeRewards(
                hre, distributor.address, bgt.address, rewardVault.address, owner.account, await time.latest()
            );

            // Claim initial rewards
            await time.increase(86400n * 7n); // 1 week later (enough time to vest all BGT rewards)

            let userExpectedReward = rewardAmount * 80n / 100n;
            let ownerExpectedReward = rewardAmount * 20n / 100n * (10_000n - 1000n) / 10_000n;
            let feeExpectedReward = rewardAmount * 20n / 100n * 1000n / 10_000n;

            const bgtBalancesBefore1 = await takeBalanceSnapshot(publicClient, bgt.address, user1.account.address, owner.account.address, feeReceiver.address);

            await rewardVault.write.getReward([user1.account.address, user1.account.address], { account: user1.account });
            await rewardVault.write.getReward([owner.account.address, owner.account.address], { account: owner.account });
            await vault.write.claimBGTReward([feeReceiver.address], { account: owner.account });

            const bgtBalancesAfter1 = await takeBalanceSnapshot(publicClient, bgt.address, user1.account.address, owner.account.address, feeReceiver.address);

            expect(bgtBalancesAfter1.get(user1.account.address) - bgtBalancesBefore1.get(user1.account.address)).to.be.approximately(userExpectedReward, 100n);
            expect(bgtBalancesAfter1.get(owner.account.address) - bgtBalancesBefore1.get(owner.account.address)).to.be.approximately(ownerExpectedReward, 100n);
            expect(bgtBalancesAfter1.get(feeReceiver.address) - bgtBalancesBefore1.get(feeReceiver.address)).to.be.approximately(feeExpectedReward, 100n);

            // Set reward fee to 10% and migrate
            const userSharesBefore = await vault.read.balanceOf([user1.account.address]);
            const userStakeBefore = await rewardVault.read.balanceOf([user1.account.address]);
            const ownerStakeBefore = await rewardVault.read.balanceOf([owner.account.address]);
            await vault.write.setRewardFeeBips([1000n], { account: owner.account });
            await vault.write.migrateFees([[user1.account.address, owner.account.address], true], { account: owner.account });
            const userSharesAfter = await vault.read.balanceOf([user1.account.address]);
            const userStakeAfter = await rewardVault.read.balanceOf([user1.account.address]);
            const ownerStakeAfter = await rewardVault.read.balanceOf([owner.account.address]);
            const { sharesMinusFee: userStakeMinusFee, rewardFee } = await splitSharesWithFee(hre, vault.address, userStakeBefore);
            expect(userSharesAfter).to.equal(userSharesBefore, "User shares should be unchanged after fee migration");
            expect(ownerStakeAfter).to.equal(ownerStakeBefore, "Owner's stake should be unaffected by fee migration");
            expect(userStakeAfter).to.equal(
                userStakeMinusFee, "Reward fee should be deducted from user's stake in the RewardVault"
            );

            await checkMigrateTransferEvents(hre, vault.address, userStakeBefore);

            // Distribute more rewards
            rewardAmount = await distributeRewards(
                hre, distributor.address, bgt.address, rewardVault.address, owner.account, await time.latest()
            );

            // Claim new rewards
            await time.increase(86400n * 7n); // 1 week later (enough time to vest all BGT rewards)

            userExpectedReward = rewardAmount * 80n / 100n * (10_000n - 1000n) / 10_000n;
            ownerExpectedReward = rewardAmount * 20n / 100n * (10_000n - 1000n) / 10_000n;
            feeExpectedReward = rewardAmount * 1000n / 10_000n;

            const bgtBalancesBefore2 = await takeBalanceSnapshot(publicClient, bgt.address, user1.account.address, owner.account.address, feeReceiver.address);

            await rewardVault.write.getReward([user1.account.address, user1.account.address], { account: user1.account });
            await rewardVault.write.getReward([owner.account.address, owner.account.address], { account: owner.account });
            await vault.write.claimBGTReward([feeReceiver.address], { account: owner.account });

            const bgtBalancesAfter2 = await takeBalanceSnapshot(publicClient, bgt.address, user1.account.address, owner.account.address, feeReceiver.address);

            expect(bgtBalancesAfter2.get(user1.account.address) - bgtBalancesBefore2.get(user1.account.address)).to.be.approximately(userExpectedReward, 100n);
            expect(bgtBalancesAfter2.get(owner.account.address) - bgtBalancesBefore2.get(owner.account.address)).to.be.approximately(ownerExpectedReward, 100n);
            expect(bgtBalancesAfter2.get(feeReceiver.address) - bgtBalancesBefore2.get(feeReceiver.address)).to.be.approximately(feeExpectedReward, 100n);
        });
    });

    describe("Validations", function () {
        it("Cannot transfer vault shares", async function () {
            const { vault, owner, user1 } = await loadFixture(deployLongPoolMockEnvironment);

            // Owner already deposited in fixture
            const depositAmount = await vault.read.balanceOf([owner.account.address]);

            await expect(vault.write.transfer([user1.account.address, depositAmount], { account: owner.account }))
                .to.be.rejectedWith("TransferNotSupported");
        });

        it("Cannot withdraw spicy tokens directly from RewardVault", async function () {
            const { vault, rewardVault, owner } = await loadFixture(deployLongPoolMockEnvironment);

            // Owner already deposited in fixture
            const depositAmount = await vault.read.balanceOf([owner.account.address]);

            await expect(rewardVault.write.withdraw([depositAmount], { account: owner.account }))
                .to.be.rejectedWith("InsufficientSelfStake");
        });
    });
});