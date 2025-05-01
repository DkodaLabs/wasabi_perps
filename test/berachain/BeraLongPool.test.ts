import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import hre from "hardhat";
import { expect } from "chai";
import { parseEther, zeroAddress, maxUint256 } from "viem";
import { deployLongPoolMockEnvironment } from "./berachainFixtures";
import { getBalance, takeBalanceSnapshot } from "../utils/StateUtils";

describe("BeraLongPool", function () {
    describe("Deployment", function () {
        it("Should deploy StakingAccountFactory correctly", async function () {
            const { addressProvider, stakingAccountFactory, beacon, ibgt, ibgtInfraredVault } = await loadFixture(deployLongPoolMockEnvironment);

            expect(await addressProvider.read.getStakingAccountFactory()).to.equal(stakingAccountFactory.address);
            expect(await stakingAccountFactory.read.beacon()).to.equal(beacon.address);
            expect(await stakingAccountFactory.read.stakingTokenToVault([ibgt.address])).to.equal(ibgtInfraredVault.address);
        });

        it("Should deploy StakingAccount correctly", async function () {
            const { user1, user2, stakingAccountFactory, sendStakingOpenPositionRequest } = await loadFixture(deployLongPoolMockEnvironment);

            expect(await stakingAccountFactory.read.userToStakingAccount([user1.account.address])).to.equal(zeroAddress);
            expect(await stakingAccountFactory.read.userToStakingAccount([user2.account.address])).to.equal(zeroAddress);

            // Test deploying a staking account while opening a position
            await sendStakingOpenPositionRequest();

            const user1StakingAccountAddress = await stakingAccountFactory.read.userToStakingAccount([user1.account.address]);
            expect(user1StakingAccountAddress).to.not.equal(zeroAddress);

            // Test deploying a staking account directly
            await stakingAccountFactory.write.getOrCreateStakingAccount([user2.account.address]);

            const user2StakingAccountAddress = await stakingAccountFactory.read.userToStakingAccount([user2.account.address]);
            expect(user2StakingAccountAddress).to.not.equal(zeroAddress);
        });
    });

    describe("Leveraged Staking", function () {
        it("Should stake a position", async function () {
            const { user1, wasabiLongPool, stakingAccountFactory, sendStakingOpenPositionRequest, openPositionRequest, totalAmountIn, ibgt, ibgtInfraredVault, ibgtRewardVault } = await loadFixture(deployLongPoolMockEnvironment);

            const { position } = await sendStakingOpenPositionRequest();

            const positionOpenedEvents = await wasabiLongPool.getEvents.PositionOpened();
            expect(positionOpenedEvents).to.have.lengthOf(1);
            const positionOpenedEvent = positionOpenedEvents[0].args;

            expect(positionOpenedEvent.positionId).to.equal(openPositionRequest.id);
            expect(positionOpenedEvent.downPayment).to.equal(totalAmountIn - positionOpenedEvent.feesToBePaid!);
            expect(positionOpenedEvent.principal).to.equal(openPositionRequest.principal);
            expect(positionOpenedEvent.collateralAmount).to.equal(await ibgt.read.balanceOf([ibgtRewardVault.address]));
            expect(positionOpenedEvent.collateralAmount).to.greaterThanOrEqual(openPositionRequest.minTargetAmount);

            const user1StakingAccountAddress = await stakingAccountFactory.read.userToStakingAccount([user1.account.address]);
            expect(user1StakingAccountAddress).to.not.equal(zeroAddress);

            const stakedEvents = await ibgtInfraredVault.getEvents.Staked();
            expect(stakedEvents).to.have.lengthOf(1);
            const stakedEvent = stakedEvents[0].args;

            expect(stakedEvent.amount).to.equal(positionOpenedEvent.collateralAmount);
            expect(stakedEvent.user).to.equal(user1StakingAccountAddress);

            expect(await wasabiLongPool.read.isPositionStaked([position.id])).to.equal(true);
            expect(await ibgt.read.balanceOf([wasabiLongPool.address])).to.equal(0n);
        });

        it("Should stake a position after opening", async function () {
            const { user1, wasabiLongPool, stakingAccountFactory, sendDefaultOpenPositionRequest, openPositionRequest, totalAmountIn, ibgt, ibgtInfraredVault, ibgtRewardVault } = await loadFixture(deployLongPoolMockEnvironment);

            const { position } = await sendDefaultOpenPositionRequest();

            const positionOpenedEvents = await wasabiLongPool.getEvents.PositionOpened();
            expect(positionOpenedEvents).to.have.lengthOf(1);
            const positionOpenedEvent = positionOpenedEvents[0].args;

            expect(positionOpenedEvent.positionId).to.equal(openPositionRequest.id);
            expect(positionOpenedEvent.downPayment).to.equal(totalAmountIn - positionOpenedEvent.feesToBePaid!);
            expect(positionOpenedEvent.principal).to.equal(openPositionRequest.principal);
            expect(positionOpenedEvent.collateralAmount).to.equal(await ibgt.read.balanceOf([wasabiLongPool.address]));
            expect(positionOpenedEvent.collateralAmount).to.greaterThanOrEqual(openPositionRequest.minTargetAmount);
            
            await wasabiLongPool.write.stakePosition([position], { account: user1.account });

            const user1StakingAccountAddress = await stakingAccountFactory.read.userToStakingAccount([user1.account.address]);
            expect(user1StakingAccountAddress).to.not.equal(zeroAddress);

            const stakedEvents = await ibgtInfraredVault.getEvents.Staked();
            expect(stakedEvents).to.have.lengthOf(1);
            const stakedEvent = stakedEvents[0].args;

            expect(stakedEvent.amount).to.equal(positionOpenedEvent.collateralAmount);
            expect(stakedEvent.user).to.equal(user1StakingAccountAddress);

            expect(await wasabiLongPool.read.isPositionStaked([position.id])).to.equal(true);
            expect(await ibgt.read.balanceOf([wasabiLongPool.address])).to.equal(0n);
            expect(await ibgt.read.balanceOf([ibgtRewardVault.address])).to.equal(position.collateralAmount);
        });
    });
});