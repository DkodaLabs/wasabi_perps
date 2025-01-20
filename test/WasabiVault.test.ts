import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseEther } from "viem";
import { deployLongPoolMockEnvironment } from "./fixtures";
import { getBalance, takeBalanceSnapshot } from "./utils/StateUtils";
import { PayoutType } from "./utils/PerpStructUtils";

describe("WasabiVault", function () {

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
            const depositAmount = await getBalance(publicClient, wethAddress, vault.address);
            const sharesPerEthBefore = await vault.read.convertToShares([parseEther("1")]);

            const shares = await vault.read.balanceOf([owner.account.address]);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Close Position
            const { request, signature } = await createSignedClosePositionRequest({ position });

            await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, request, signature], { account: user1.account });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1, "PositionClosed event not emitted");
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
            expect(await getBalance(publicClient, wethAddress, vault.address)).to.equal(1n);
            expect(wethBalanceAfter - wethBalanceBefore).to.equal(withdrawAmount, "Balance change does not match withdraw amount");
            expect(sharesPerEthAfter).to.lessThan(sharesPerEthBefore);
            expect(withdrawAmount).to.equal(depositAmount + interest - 1n);
        });
    });

    describe("Validations", function () {
        it("Only pools can borrow", async function () {
            const {vault, user1} = await loadFixture(deployLongPoolMockEnvironment);

            await expect(vault.write.borrow(
                [1n],
                { account: user1.account }
            )).to.be.rejectedWith("CallerNotPool");
        })

        it("Only pools can record repayment", async function () {
            const {vault, user1} = await loadFixture(deployLongPoolMockEnvironment);

            await expect(vault.write.recordRepayment(
                [1n, 1n, false],
                { account: user1.account }
            )).to.be.rejectedWith("CallerNotPool");

            await expect(vault.write.recordRepayment(
                [1n, 1n, true],
                { account: user1.account }
            )).to.be.rejectedWith("CallerNotPool");
        })

        it("Only vault admin can donate", async function () {
            const {vault, user1} = await loadFixture(deployLongPoolMockEnvironment);

            await expect(vault.write.donate(
                [1n],
                { account: user1.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");
        })
        
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
