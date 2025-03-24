import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { formatEther, parseEther, zeroAddress, maxUint256, getAddress } from "viem";
import { deployLongPoolMockEnvironment, validatorPubKey } from "./berachainFixtures";
import { getBalance, takeBalanceSnapshot } from "../utils/StateUtils";
import { formatEthValue, PayoutType } from "../utils/PerpStructUtils";

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
            const { vault, rewardVault, weth, user1, publicClient } = await loadFixture(deployLongPoolMockEnvironment);
            const rewardFeeBips = await vault.read.rewardFeeBips();

            const amount = parseEther("100");
            await weth.write.deposit({ value: amount, account: user1.account });
            await weth.write.approve([vault.address, amount], { account: user1.account });

            const wethBalancesBefore = await takeBalanceSnapshot(publicClient, weth.address, user1.account.address, vault.address);

            await vault.write.deposit([amount, user1.account.address], { account: user1.account });

            const wethBalancesAfter = await takeBalanceSnapshot(publicClient, weth.address, user1.account.address, vault.address);
            const userSharesAfter = await vault.read.balanceOf([user1.account.address]);

            expect(wethBalancesBefore.get(user1.account.address) - amount).to.equal(wethBalancesAfter.get(user1.account.address));
            expect(wethBalancesBefore.get(vault.address) + amount).to.equal(wethBalancesAfter.get(vault.address));
            expect(userSharesAfter).to.equal(amount);

            const transferEvents = await vault.getEvents.Transfer();
            expect(transferEvents.length).to.equal(3);
            expect(transferEvents[0].args.from).to.equal(zeroAddress);
            expect(transferEvents[0].args.to).to.equal(vault.address);
            expect(transferEvents[1].args.from).to.equal(vault.address);
            expect(transferEvents[1].args.to).to.equal(rewardVault.address);
            expect(transferEvents[2].args.from).to.equal(vault.address);
            expect(transferEvents[2].args.to).to.equal(rewardVault.address);

            const depositEvents = await vault.getEvents.Deposit();
            expect(depositEvents.length).to.equal(1);
            expect(depositEvents[0].args.sender).to.equal(getAddress(user1.account.address));
            expect(depositEvents[0].args.owner).to.equal(getAddress(user1.account.address));
            expect(depositEvents[0].args.assets).to.equal(amount);
            expect(depositEvents[0].args.shares).to.equal(amount);

            const delegateStakedEvents = await rewardVault.getEvents.DelegateStaked();
            expect(delegateStakedEvents.length).to.equal(1);
            expect(delegateStakedEvents[0].args.account).to.equal(getAddress(user1.account.address));
            expect(delegateStakedEvents[0].args.delegate).to.equal(vault.address);
            expect(delegateStakedEvents[0].args.amount).to.equal(amount * (10000n - rewardFeeBips) / 10000n);

            const stakedEvents = await rewardVault.getEvents.Staked();
            expect(stakedEvents.length).to.equal(2);
            expect(stakedEvents[0].args.account).to.equal(getAddress(user1.account.address));
            expect(stakedEvents[0].args.amount).to.equal(amount * (10000n - rewardFeeBips) / 10000n);
            expect(stakedEvents[1].args.account).to.equal(vault.address);
            expect(stakedEvents[1].args.amount).to.equal(amount * rewardFeeBips / 10000n);
        });

        it("Should unstake and withdraw", async function () {
            const { vault, rewardVault, weth, owner, publicClient } = await loadFixture(deployLongPoolMockEnvironment);
            const rewardFeeBips = await vault.read.rewardFeeBips();

            // Owner already deposited in fixture
            const depositAmount = await vault.read.balanceOf([owner.account.address]);
            const wethBalancesBefore = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, vault.address);

            await vault.write.withdraw([depositAmount, owner.account.address, owner.account.address], { account: owner.account });

            const wethBalancesAfter = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, vault.address);
            const userSharesAfter = await vault.read.balanceOf([owner.account.address]);

            expect(wethBalancesBefore.get(owner.account.address) + depositAmount).to.equal(wethBalancesAfter.get(owner.account.address));
            expect(wethBalancesBefore.get(vault.address) - depositAmount).to.equal(wethBalancesAfter.get(vault.address));
            expect(userSharesAfter).to.equal(0);

            const transferEvents = await vault.getEvents.Transfer();
            expect(transferEvents.length).to.equal(3);
            expect(transferEvents[0].args.from).to.equal(rewardVault.address);
            expect(transferEvents[0].args.to).to.equal(vault.address);
            expect(transferEvents[1].args.from).to.equal(rewardVault.address);
            expect(transferEvents[1].args.to).to.equal(vault.address);
            expect(transferEvents[2].args.from).to.equal(vault.address);
            expect(transferEvents[2].args.to).to.equal(zeroAddress);

            const withdrawEvents = await vault.getEvents.Withdraw();
            expect(withdrawEvents.length).to.equal(1);
            expect(withdrawEvents[0].args.sender).to.equal(getAddress(owner.account.address));
            expect(withdrawEvents[0].args.owner).to.equal(getAddress(owner.account.address));
            expect(withdrawEvents[0].args.assets).to.equal(depositAmount);
            expect(withdrawEvents[0].args.shares).to.equal(depositAmount);

            const delegateWithdrawnEvents = await rewardVault.getEvents.DelegateWithdrawn();
            expect(delegateWithdrawnEvents.length).to.equal(1);
            expect(delegateWithdrawnEvents[0].args.account).to.equal(getAddress(owner.account.address));
            expect(delegateWithdrawnEvents[0].args.delegate).to.equal(vault.address);
            expect(delegateWithdrawnEvents[0].args.amount).to.equal(depositAmount * (10000n - rewardFeeBips) / 10000n);

            const withdrawnEvents = await rewardVault.getEvents.Withdrawn();
            expect(withdrawnEvents.length).to.equal(2);
            expect(withdrawnEvents[0].args.account).to.equal(getAddress(owner.account.address));
            expect(withdrawnEvents[0].args.amount).to.equal(depositAmount * (10000n - rewardFeeBips) / 10000n);
            expect(withdrawnEvents[1].args.account).to.equal(vault.address);
            expect(withdrawnEvents[1].args.amount).to.equal(depositAmount * rewardFeeBips / 10000n);
        });

        it("Should partially unstake and withdraw", async function () {
            const { vault, rewardVault, weth, owner, publicClient } = await loadFixture(deployLongPoolMockEnvironment);
            const rewardFeeBips = await vault.read.rewardFeeBips();

            // Owner already deposited in fixture
            const depositAmount = await vault.read.balanceOf([owner.account.address]);
            const withdrawAmount = depositAmount / 7n;
            const wethBalancesBefore = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, vault.address);
            
            await vault.write.withdraw([withdrawAmount, owner.account.address, owner.account.address], { account: owner.account });

            const wethBalancesAfter = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, vault.address);
            const userSharesAfter = await vault.read.balanceOf([owner.account.address]);

            expect(wethBalancesBefore.get(owner.account.address) + withdrawAmount).to.equal(wethBalancesAfter.get(owner.account.address));
            expect(wethBalancesBefore.get(vault.address) - withdrawAmount).to.equal(wethBalancesAfter.get(vault.address));
            expect(userSharesAfter).to.equal(depositAmount - withdrawAmount);

            const withdrawEvents = await vault.getEvents.Withdraw();
            expect(withdrawEvents.length).to.equal(1);
            expect(withdrawEvents[0].args.sender).to.equal(getAddress(owner.account.address));
            expect(withdrawEvents[0].args.owner).to.equal(getAddress(owner.account.address));
            expect(withdrawEvents[0].args.assets).to.equal(withdrawAmount);
            expect(withdrawEvents[0].args.shares).to.equal(withdrawAmount);

            const withdrawnEvents = await rewardVault.getEvents.Withdrawn();
            expect(withdrawnEvents.length).to.equal(2);
            expect(withdrawnEvents[0].args.account).to.equal(getAddress(owner.account.address));
            expect(withdrawnEvents[0].args.amount).to.be.approximately(withdrawAmount * (10000n - rewardFeeBips) / 10000n, 1n);
            expect(withdrawnEvents[1].args.account).to.equal(vault.address);
            expect(withdrawnEvents[1].args.amount).to.be.approximately(withdrawAmount * rewardFeeBips / 10000n, 1n);

            await vault.write.withdraw([userSharesAfter, owner.account.address, owner.account.address], { account: owner.account });

            const finalWethBalances = await takeBalanceSnapshot(publicClient, weth.address, owner.account.address, vault.address);
            const userSharesFinal = await vault.read.balanceOf([owner.account.address]);

            expect(wethBalancesAfter.get(owner.account.address) + userSharesAfter).to.equal(finalWethBalances.get(owner.account.address));
            expect(wethBalancesAfter.get(vault.address) - userSharesAfter).to.equal(finalWethBalances.get(vault.address));
            expect(userSharesFinal).to.equal(0);
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
                weth,
            } = await loadFixture(deployLongPoolMockEnvironment);
            const rewardFeeBips = await vault.read.rewardFeeBips();
            
            // Owner already deposited in fixture
            const depositAmount = await getBalance(publicClient, weth.address, vault.address);
            const sharesPerEthBefore = await vault.read.convertToShares([parseEther("1")]);

            const shares = await vault.read.balanceOf([owner.account.address]);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Distribute rewards
            expect(await bgt.read.normalizedBoost([validatorPubKey])).to.equal(parseEther("1"));
            const timestamp = await time.latest();
            await distributor.write.distributeFor([BigInt(timestamp), validatorPubKey], { account: owner.account });
            const distributedEvents = await distributor.getEvents.Distributed();
            expect(distributedEvents).to.have.lengthOf(1, "Distributed event not emitted");
            const distributedEvent = distributedEvents[0].args;
            const rewardAmount = distributedEvent.amount!;
            expect (distributedEvent.receiver).to.equal(rewardVault.address);
            expect (rewardAmount).to.be.gt(0n);

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({ position });

            await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            // Checks
            const closeEvents = await wasabiLongPool.getEvents.PositionClosed();
            expect(closeEvents).to.have.lengthOf(1, "PositionClosed event not emitted");
            const closePositionEvent = closeEvents[0].args;
            const interest = closePositionEvent.interestPaid!;

            await time.increase(86400n * 7n); // 1 week later (enough time to vest all BGT rewards)

            const wethBalanceBefore = await getBalance(publicClient, weth.address, owner.account.address);
            const bgtBalanceBefore = await getBalance(publicClient, bgt.address, owner.account.address);
            
            const hash =
                await vault.write.redeem([shares, owner.account.address, owner.account.address], { account: owner.account });
            // const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            // console.log("Redeem gas cost: ", formatEther(gasUsed));

            const event = (await vault.getEvents.Withdraw())[0].args!;
            const wethBalanceAfter = await getBalance(publicClient, weth.address, owner.account.address);
            const bgtBalanceAfter = await await getBalance(publicClient, bgt.address, owner.account.address);
            const sharesPerEthAfter = await vault.read.convertToShares([parseEther("1")]);
            const withdrawAmount = event.assets!;
            
            expect(await vault.read.balanceOf([owner.account.address])).to.equal(0n);
            expect(await getBalance(publicClient, weth.address, vault.address)).to.equal(0n);
            expect(wethBalanceAfter - wethBalanceBefore).to.equal(withdrawAmount, "WETH balance change does not match withdraw amount");
            expect(bgtBalanceAfter - bgtBalanceBefore).to.be.approximately(
                rewardAmount * (10000n - rewardFeeBips) / 10000n, 25n, "BGT balance change does not match reward amount minus fee"
            );
            expect(sharesPerEthAfter).to.equal(sharesPerEthBefore);
            expect(withdrawAmount).to.equal(depositAmount + interest);

            // Now claim reward fee accrued to the vault
            await vault.write.claimBGTReward([owner.account.address], { account: owner.account });
            const finalBgtBalance = await getBalance(publicClient, bgt.address, owner.account.address);
            expect(finalBgtBalance - bgtBalanceAfter).to.be.approximately(
                rewardAmount * rewardFeeBips / 10000n, 25n, "BGT balance change does not match reward fee"
            );
        });

        it("Should pay incentive for rewards", async function () {
            const {
                user1,
                owner,
                vault,
                rewardVault,
                distributor,
                weth,
            } = await loadFixture(deployLongPoolMockEnvironment);

            const amount = parseEther("100");
            await weth.write.deposit({ value: amount, account: user1.account });
            await weth.write.approve([vault.address, amount], { account: user1.account });

            // WETH incentive added to RewardVault in fixture
            const minRate = parseEther("1");
            const rate = parseEther("10");

            // Incentive checks
            expect(await rewardVault.read.getWhitelistedTokensCount()).to.equal(1);
            const [ minIncentiveRate, incentiveRate, amountRemaining, manager ] = await rewardVault.read.incentives([weth.address]);
            expect(minIncentiveRate).to.equal(minRate);
            expect(incentiveRate).to.equal(rate);
            expect(amountRemaining).to.equal(amount);
            expect(manager).to.equal(getAddress(owner.account.address));

            // Deposit
            await vault.write.deposit([amount, user1.account.address], { account: user1.account });

            await time.increase(86400n); // 1 day later

            const ownerWETHBalanceBefore = await weth.read.balanceOf([owner.account.address]);

            // Distribute rewards
            const timestamp = await time.latest();
            await distributor.write.distributeFor([BigInt(timestamp), validatorPubKey], { account: owner.account });
            const distributedEvents = await distributor.getEvents.Distributed();
            expect(distributedEvents).to.have.lengthOf(1, "Distributed event not emitted");
            const distributedEvent = distributedEvents[0].args;
            const rewardAmount = distributedEvent.amount!;
            expect (distributedEvent.receiver).to.equal(rewardVault.address);
            expect (rewardAmount).to.be.gt(0n);

            const ownerWETHBalanceAfter = await weth.read.balanceOf([owner.account.address]);

            // Check that validator received incentive
            expect(ownerWETHBalanceAfter - ownerWETHBalanceBefore).to.equal(rewardAmount * 10n, "Owner did not receive incentive");
        });

        it("Should migrate reward fee for users who deposit before fee change", async function () {
            const { vault, rewardVault, weth, bgt, distributor, user1, user2, owner, publicClient } = await loadFixture(deployLongPoolMockEnvironment);
            const feeReceiver = user2.account;
            
            // Set reward fee to 0
            await vault.write.setRewardFeeBips([0n], { account: owner.account });

            // Owner already deposited 20 WETH in fixture, while reward fee was 5%
            // User deposits while the reward fee is 0%
            const amount = parseEther("80");
            await weth.write.deposit({ value: amount, account: user1.account });
            await weth.write.approve([vault.address, amount], { account: user1.account });
            await vault.write.deposit([amount, user1.account.address], { account: user1.account });

            const depositTransferEvents = await vault.getEvents.Transfer();
            expect(depositTransferEvents.length).to.equal(2);
            expect(depositTransferEvents[0].args.from).to.equal(zeroAddress);
            expect(depositTransferEvents[0].args.to).to.equal(vault.address);
            expect(depositTransferEvents[1].args.from).to.equal(vault.address);
            expect(depositTransferEvents[1].args.to).to.equal(rewardVault.address);
            expect(depositTransferEvents[1].args.value).to.equal(amount);
            expect(await rewardVault.read.balanceOf([user1.account.address])).to.equal(
                amount, "All of user's shares should be deposited on their behalf"
            );

            await time.increase(86400n); // 1 day later

            // Distribute rewards
            expect(await bgt.read.normalizedBoost([validatorPubKey])).to.equal(parseEther("1"));
            let timestamp = await time.latest();
            await distributor.write.distributeFor([BigInt(timestamp), validatorPubKey], { account: owner.account });
            let distributedEvents = await distributor.getEvents.Distributed();
            expect(distributedEvents).to.have.lengthOf(1, "Distributed event not emitted");
            let distributedEvent = distributedEvents[0].args;
            let rewardAmount = distributedEvent.amount!;
            expect (distributedEvent.receiver).to.equal(rewardVault.address);
            expect (rewardAmount).to.be.gt(0n);

            // Claim initial rewards
            await time.increase(86400n * 7n); // 1 week later (enough time to vest all BGT rewards)

            let userExpectedReward = rewardAmount * 80n / 100n;
            let ownerExpectedReward = rewardAmount * 20n / 100n * (10_000n - 500n) / 10_000n;
            let feeExpectedReward = rewardAmount * 20n / 100n * 500n / 10_000n;

            const bgtBalancesBefore1 = await takeBalanceSnapshot(publicClient, bgt.address, user1.account.address, owner.account.address, feeReceiver.address);

            await rewardVault.write.getReward([user1.account.address, user1.account.address], { account: user1.account });
            await rewardVault.write.getReward([owner.account.address, owner.account.address], { account: owner.account });
            await vault.write.claimBGTReward([feeReceiver.address], { account: owner.account });

            const bgtBalancesAfter1 = await takeBalanceSnapshot(publicClient, bgt.address, user1.account.address, owner.account.address, feeReceiver.address);

            expect(bgtBalancesAfter1.get(user1.account.address) - bgtBalancesBefore1.get(user1.account.address)).to.be.approximately(userExpectedReward, 100n);
            expect(bgtBalancesAfter1.get(owner.account.address) - bgtBalancesBefore1.get(owner.account.address)).to.be.approximately(ownerExpectedReward, 100n);
            expect(bgtBalancesAfter1.get(feeReceiver.address) - bgtBalancesBefore1.get(feeReceiver.address)).to.be.approximately(feeExpectedReward, 100n);

            // Set reward fee to 5% and migrate
            const userSharesBefore = await vault.read.balanceOf([user1.account.address]);
            const userStakeBefore = await rewardVault.read.balanceOf([user1.account.address]);
            const ownerStakeBefore = await rewardVault.read.balanceOf([owner.account.address]);
            await vault.write.setRewardFeeBips([500n], { account: owner.account });
            await vault.write.migrateFees([[user1.account.address, owner.account.address]], { account: owner.account });
            const userSharesAfter = await vault.read.balanceOf([user1.account.address]);
            const userStakeAfter = await rewardVault.read.balanceOf([user1.account.address]);
            const ownerStakeAfter = await rewardVault.read.balanceOf([owner.account.address]);
            expect(userSharesAfter).to.equal(userSharesBefore, "User shares should be unchanged after fee migration");
            expect(ownerStakeAfter).to.equal(ownerStakeBefore, "Owner's stake should be unaffected by fee migration");
            expect(userStakeAfter).to.equal(
                userStakeBefore * (10_000n - 500n) / 10_000n, "Reward fee should be deducted from user's stake in the RewardVault"
            );

            const migrateTransferEvents = await vault.getEvents.Transfer();
            expect(migrateTransferEvents.length).to.equal(2);
            expect(migrateTransferEvents[0].args.from).to.equal(rewardVault.address);
            expect(migrateTransferEvents[0].args.to).to.equal(vault.address);
            expect(migrateTransferEvents[0].args.value).to.equal(amount * 500n / 10_000n);
            expect(migrateTransferEvents[1].args.from).to.equal(vault.address);
            expect(migrateTransferEvents[1].args.to).to.equal(rewardVault.address);
            expect(migrateTransferEvents[1].args.value).to.equal(amount * 500n / 10_000n);

            // Distribute more rewards
            expect(await bgt.read.normalizedBoost([validatorPubKey])).to.equal(parseEther("1"));
            timestamp = await time.latest();
            await distributor.write.distributeFor([BigInt(timestamp), validatorPubKey], { account: owner.account });
            distributedEvents = await distributor.getEvents.Distributed();
            expect(distributedEvents).to.have.lengthOf(1, "Distributed event not emitted");
            distributedEvent = distributedEvents[0].args;
            rewardAmount = distributedEvent.amount!;
            expect (distributedEvent.receiver).to.equal(rewardVault.address);
            expect (rewardAmount).to.be.gt(0n);

            // Claim new rewards
            await time.increase(86400n * 7n); // 1 week later (enough time to vest all BGT rewards)

            userExpectedReward = rewardAmount * 80n / 100n * (10_000n - 500n) / 10_000n;
            ownerExpectedReward = rewardAmount * 20n / 100n * (10_000n - 500n) / 10_000n;
            feeExpectedReward = rewardAmount * 500n / 10_000n;

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
            const { vault, weth, owner, user1 } = await loadFixture(deployLongPoolMockEnvironment);

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