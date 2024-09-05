import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseEther } from "viem";
import { deployLongPoolMockEnvironment } from "./fixtures";
import { getBalance } from "./utils/StateUtils";

describe("WETHVault", function () {

    describe("Interest earned", function () {
        it("Interest earned and sold", async function () {
            const {
                sendDefaultOpenPositionRequest,
                createSignedClosePositionRequest,
                wasabiLongPool,
                user1,
                owner,
                vault,
                publicClient,
                wethAddress,
            } = await loadFixture(deployLongPoolMockEnvironment);
            
            // Owner already deposited in fixture
            const depositAmount = await getBalance(publicClient, wethAddress, wasabiLongPool.address);
            const sharesPerEthBefore = await vault.read.convertToShares([parseEther("1")]);

            const shares = await vault.read.balanceOf([owner.account.address]);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({ position });

            await wasabiLongPool.write.closePosition([true, request, signature], { account: user1.account });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;
            const interest = closePositionEvent.interestPaid!;

            const wethBalanceBefore = await getBalance(publicClient, wethAddress, owner.account.address);
            
            const redeemTransaction =
                await vault.write.redeem([shares, owner.account.address, owner.account.address], { account: owner.account });

            const event = (await vault.getEvents.Withdraw())[0].args!;
            const wethBalanceAfter = await getBalance(publicClient, wethAddress, owner.account.address);
            const sharesPerEthAfter = await vault.read.convertToShares([parseEther("1")]);
            const withdrawAmount = event.assets!;

            console.log(await vault.read.totalAssetValue());
            
            expect(await vault.read.balanceOf([owner.account.address])).to.equal(0n);
            expect(await getBalance(publicClient, wethAddress, wasabiLongPool.address)).to.equal(1n);
            expect(wethBalanceAfter - wethBalanceBefore).to.equal(withdrawAmount);
            expect(sharesPerEthAfter).to.lessThan(sharesPerEthBefore);
            expect(withdrawAmount).to.equal(depositAmount + interest - 1n);
        });
    });

    describe("Validations", function () {
        it("Only depositor can redeem", async function () {
            const {vault, owner, user1, orderExecutor} = await loadFixture(deployLongPoolMockEnvironment);

            // Owner already deposited in fixture
            const shares = await vault.read.balanceOf([owner.account.address]);

            await expect(vault.write.redeem(
                [shares, owner.account.address, owner.account.address], 
                { account: user1.account }
            )).to.be.rejectedWith("ERC20InsufficientAllowance");

            await expect(vault.write.redeem(
                [shares, owner.account.address, owner.account.address], 
                { account: orderExecutor.account }
            )).to.be.rejectedWith("ERC20InsufficientAllowance");
        });

        it("Only depositor can withdraw", async function () {
            const {vault, owner, user1, orderExecutor} = await loadFixture(deployLongPoolMockEnvironment);

            // Owner already deposited in fixture
            const shares = await vault.read.balanceOf([owner.account.address]);
            const assets = await vault.read.convertToAssets([shares]);

            await expect(vault.write.withdraw(
                [assets, owner.account.address, owner.account.address], 
                { account: user1.account }
            )).to.be.rejectedWith("ERC20InsufficientAllowance");

            await expect(vault.write.withdraw(
                [assets, owner.account.address, owner.account.address], 
                { account: orderExecutor.account }
            )).to.be.rejectedWith("ERC20InsufficientAllowance");
        });
    });
});
