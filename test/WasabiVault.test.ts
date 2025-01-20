import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { formatEther, parseEther } from "viem";
import { deployLongPoolMockEnvironment, deployMockV2VaultImpl } from "./fixtures";
import { getBalance, takeBalanceSnapshot } from "./utils/StateUtils";
import { formatEthValue, PayoutType } from "./utils/PerpStructUtils";

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
            
            const hash =
                await vault.write.redeem([shares, owner.account.address, owner.account.address], { account: owner.account });
            // const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
            // console.log("Redeem gas cost: ", formatEther(gasUsed));

            const event = (await vault.getEvents.Withdraw())[0].args!;
            const wethBalanceAfter = await getBalance(publicClient, wethAddress, owner.account.address);
            const sharesPerEthAfter = await vault.read.convertToShares([parseEther("1")]);
            const withdrawAmount = event.assets!;
            
            expect(await vault.read.balanceOf([owner.account.address])).to.equal(0n);
            expect(await getBalance(publicClient, wethAddress, vault.address)).to.equal(0n);
            expect(wethBalanceAfter - wethBalanceBefore).to.equal(withdrawAmount, "Balance change does not match withdraw amount");
            expect(sharesPerEthAfter).to.equal(sharesPerEthBefore);
            expect(withdrawAmount).to.equal(depositAmount + interest);
        });
    });

    describe("Dust cleaning", function () {
        it("Clean dust from vault", async function () {
            const {
                user1,
                owner,
                vault,
                publicClient,
                weth,
            } = await loadFixture(deployLongPoolMockEnvironment);
            
            // Owner already deposited in fixture
            const ownerShares = await vault.read.balanceOf([owner.account.address]);

            // Deposit from user1
            const depositAmount = parseEther("1");
            await weth.write.approve([vault.address, depositAmount], { account: user1.account });
            await vault.write.deposit([depositAmount, user1.account.address], { account: user1.account });
            const userShares = await vault.read.balanceOf([user1.account.address]);

            // Withdraw all deposits
            await vault.write.redeem([ownerShares, owner.account.address, owner.account.address], { account: owner.account });
            await vault.write.redeem([userShares, user1.account.address, user1.account.address], { account: user1.account });

            expect(await vault.read.balanceOf([owner.account.address])).to.equal(0n);
            expect(await vault.read.balanceOf([user1.account.address])).to.equal(0n);
            expect(await getBalance(publicClient, weth.address, vault.address)).to.equal(0n);

            // Donate dust
            const dust = 1n;
            await weth.write.approve([vault.address, dust], { account: owner.account });
            await vault.write.donate([dust], { account: owner.account });

            // Check distorting effect of dust
            const sharesPerEthBefore = await vault.read.convertToShares([parseEther("1")]);
            expect(sharesPerEthBefore).to.equal(parseEther("0.5"));

            // Clean dust
            await vault.write.cleanDust({ account: owner.account });

            // Checks
            const sharesPerEthAfter = await vault.read.convertToShares([parseEther("1")]);
            expect(sharesPerEthAfter).to.equal(parseEther("1"));
            expect(await getBalance(publicClient, weth.address, vault.address)).to.equal(0n);
        });

        it("Very small deposit is not treated as dust", async function () {
            const {
                user1,
                owner,
                vault,
                publicClient,
                weth,
            } = await loadFixture(deployLongPoolMockEnvironment);
            
            // Owner already deposited in fixture
            const ownerShares = await vault.read.balanceOf([owner.account.address]);

            // Deposit very small amount from user1
            const depositAmount = parseEther("0.000000001");
            await weth.write.approve([vault.address, depositAmount], { account: user1.account });
            await vault.write.deposit([depositAmount, user1.account.address], { account: user1.account });
            const userShares = await vault.read.balanceOf([user1.account.address]);

            // Withdraw owner's large deposit first and check that user's small deposit is still there
            await vault.write.redeem([ownerShares, owner.account.address, owner.account.address], { account: owner.account });

            expect(await vault.read.balanceOf([owner.account.address])).to.equal(0n);
            expect(await vault.read.balanceOf([user1.account.address])).to.be.greaterThan(0n);
            expect(await getBalance(publicClient, weth.address, vault.address)).to.be.greaterThan(0n);

            // Withdraw user's small deposit
            await vault.write.redeem([userShares, user1.account.address, user1.account.address], { account: user1.account });

            expect(await vault.read.balanceOf([user1.account.address])).to.equal(0n);
            expect(await getBalance(publicClient, weth.address, vault.address)).to.equal(0n);

            // Check that dust is not left behind after withdrawing user's small deposit
            const sharesPerEth = await vault.read.convertToShares([parseEther("1")]);
            expect(sharesPerEth).to.equal(parseEther("1"));
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

        it("Only admin can upgrade", async function () {
            const {vault, owner, user1} = await loadFixture(deployLongPoolMockEnvironment);

            const {newVaultImpl} = await loadFixture(deployMockV2VaultImpl)

            await expect(vault.write.upgradeToAndCall(
                [newVaultImpl.address, "0x"],
                { account: user1.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");

            await expect(vault.write.upgradeToAndCall(
                [newVaultImpl.address, "0x"],
                { account: owner.account }
            )).to.be.fulfilled;
        })

        it("Only vault admin can donate", async function () {
            const {vault, owner, vaultAdmin, weth} = await loadFixture(deployLongPoolMockEnvironment);

            await expect(vault.write.donate(
                [1n],
                { account: owner.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");

            await weth.write.deposit({ value: 1n, account: vaultAdmin.account });
            await weth.write.approve([vault.address, 1n], { account: vaultAdmin.account });

            await expect (vault.write.donate(
                [1n],
                { account: vaultAdmin.account }
            )).to.be.fulfilled;
        })

        it("Only vault admin can clean dust", async function () {
            const {vault, user1} = await loadFixture(deployLongPoolMockEnvironment);

            await expect(vault.write.cleanDust(
                { account: user1.account }
            )).to.be.rejectedWith("OwnableUnauthorizedAccount");
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
