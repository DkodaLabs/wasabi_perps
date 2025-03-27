import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { formatEther, getAddress, maxUint256, parseEther } from "viem";
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

    describe("Admin borrowing", function () {
        it("Admin borrows and repays with interest", async function () {
            const {
                user1,
                owner,
                vaultAdmin,
                vault,
                publicClient,
                weth,
            } = await loadFixture(deployLongPoolMockEnvironment);

            // Owner already deposited in fixture
            const ownerShares = await vault.read.balanceOf([owner.account.address]);
            const assetsPerShareBefore = await vault.read.convertToAssets([parseEther("1")]);
            const totalAssetsBefore = await vault.read.totalAssets();
            const wethBalancesBefore = await takeBalanceSnapshot(
                publicClient, weth.address, user1.account.address, vaultAdmin.account.address, vault.address
            );

            // Borrow from vault and send to user1
            const borrowAmount = ownerShares / 2n;
            await vault.write.adminBorrow([user1.account.address, borrowAmount], { account: vaultAdmin.account });

            // Borrow checks
            const totalAssetsAfterBorrow = await vault.read.totalAssets();
            const wethBalancesAfterBorrow = await takeBalanceSnapshot(
                publicClient, weth.address, user1.account.address, vaultAdmin.account.address, vault.address
            );
            const userDebtAfterBorrow = await vault.read.adminBorrowerDebt([user1.account.address]);
            expect(await vault.read.balanceOf([owner.account.address])).to.equal(ownerShares, "Owner shares should be unchanged");
            expect(totalAssetsAfterBorrow).to.equal(totalAssetsBefore, "Total asset value should be unchanged");
            expect(wethBalancesAfterBorrow.get(vaultAdmin.account.address)).to.equal(
                wethBalancesBefore.get(vaultAdmin.account.address),
                "Vault admin WETH balance should be unchanged"
            );
            expect(wethBalancesAfterBorrow.get(vault.address)).to.equal(
                wethBalancesBefore.get(vault.address) - borrowAmount, 
                "Vault WETH balance should be reduced by borrow amount"
            );
            expect(wethBalancesAfterBorrow.get(user1.account.address)).to.equal(
                wethBalancesBefore.get(user1.account.address) + borrowAmount, 
                "User1 should have received borrow amount"
            );
            expect(userDebtAfterBorrow).to.equal(borrowAmount, "Admin borrower debt should be recorded for user1");
            const adminBorrowEvents = await vault.getEvents.AdminBorrow();
            expect(adminBorrowEvents).to.have.lengthOf(1, "AdminBorrow event not emitted");
            const adminBorrowEvent = adminBorrowEvents[0].args;
            expect(adminBorrowEvent.receiver).to.equal(getAddress(user1.account.address));
            expect(adminBorrowEvent.amount).to.equal(borrowAmount);

            // Repay with interest through vault admin
            const interest = borrowAmount / 10n;
            const totalRepayment = borrowAmount + interest;
            await weth.write.deposit({ value: interest, account: user1.account });
            await weth.write.transfer([vaultAdmin.account.address, totalRepayment], { account: user1.account });
            await weth.write.approve([vault.address, totalRepayment], { account: vaultAdmin.account });
            await vault.write.adminRepayDebt([totalRepayment, borrowAmount, user1.account.address, false], { account: vaultAdmin.account });

            // Repay checks
            const wethBalancesAfterRepay = await takeBalanceSnapshot(
                publicClient, weth.address, user1.account.address, vaultAdmin.account.address, vault.address
            );
            const assetsPerShareAfter = await vault.read.convertToAssets([parseEther("1")]);
            const totalAssetsAfterRepay = await vault.read.totalAssets();
            const userDebtAfterRepay = await vault.read.adminBorrowerDebt([user1.account.address]);
            expect(assetsPerShareAfter).to.be.gt(assetsPerShareBefore, "Assets per share should increase after interest is paid");
            expect(totalAssetsAfterRepay).to.equal(totalAssetsBefore + interest, "Total assets should increase by interest");
            expect(wethBalancesAfterRepay.get(vault.address)).to.equal(
                wethBalancesBefore.get(vault.address) + interest,
                "Vault WETH balance should be increased by interest and debt repaid"
            );
            expect(wethBalancesAfterRepay.get(user1.account.address)).to.equal(
                wethBalancesBefore.get(user1.account.address),
                "User1 WETH balance should be back to where it started"
            );
            expect(userDebtAfterRepay).to.equal(0n, "Admin borrower debt should be cleared");
            const adminDebtRepaidEvents = await vault.getEvents.AdminDebtRepaid();
            expect(adminDebtRepaidEvents).to.have.lengthOf(1, "AdminDebtRepaid event not emitted");
            const adminDebtRepaidEvent = adminDebtRepaidEvents[0].args;
            expect(adminDebtRepaidEvent.debtor).to.equal(getAddress(user1.account.address));
            expect(adminDebtRepaidEvent.debtRepaid).to.equal(borrowAmount);
            expect(adminDebtRepaidEvent.interestPaid).to.equal(interest);
        });

        it("Admin borrows and debtor repays directly at a loss", async function () {
            const {
                user1,
                owner,
                vaultAdmin,
                vault,
                publicClient,
                weth,
            } = await loadFixture(deployLongPoolMockEnvironment);

            // Owner already deposited in fixture
            const ownerShares = await vault.read.balanceOf([owner.account.address]);
            const assetsPerShareBefore = await vault.read.convertToAssets([parseEther("1")]);
            const totalAssetsBefore = await vault.read.totalAssets();
            const wethBalancesBefore = await takeBalanceSnapshot(
                publicClient, weth.address, user1.account.address, vaultAdmin.account.address, vault.address
            );

            // Borrow from vault and send to user1
            const borrowAmount = ownerShares / 2n;
            await vault.write.adminBorrow([user1.account.address, borrowAmount], { account: vaultAdmin.account });

            // Borrow checks
            const totalAssetsAfterBorrow = await vault.read.totalAssets();
            const wethBalancesAfterBorrow = await takeBalanceSnapshot(
                publicClient, weth.address, user1.account.address, vaultAdmin.account.address, vault.address
            );
            const userDebtAfterBorrow = await vault.read.adminBorrowerDebt([user1.account.address]);
            expect(await vault.read.balanceOf([owner.account.address])).to.equal(ownerShares, "Owner shares should be unchanged");
            expect(totalAssetsAfterBorrow).to.equal(totalAssetsBefore, "Total asset value should be unchanged");
            expect(wethBalancesAfterBorrow.get(vaultAdmin.account.address)).to.equal(
                wethBalancesBefore.get(vaultAdmin.account.address),
                "Vault admin WETH balance should be unchanged"
            );
            expect(wethBalancesAfterBorrow.get(vault.address)).to.equal(
                wethBalancesBefore.get(vault.address) - borrowAmount, 
                "Vault WETH balance should be reduced by borrow amount"
            );
            expect(wethBalancesAfterBorrow.get(user1.account.address)).to.equal(
                wethBalancesBefore.get(user1.account.address) + borrowAmount, 
                "User1 should have received borrow amount"
            );
            expect(userDebtAfterBorrow).to.equal(borrowAmount, "Admin borrower debt should be recorded for user1");
            const adminBorrowEvents = await vault.getEvents.AdminBorrow();
            expect(adminBorrowEvents).to.have.lengthOf(1, "AdminBorrow event not emitted");
            const adminBorrowEvent = adminBorrowEvents[0].args;
            expect(adminBorrowEvent.receiver).to.equal(getAddress(user1.account.address));
            expect(adminBorrowEvent.amount).to.equal(borrowAmount);

            // Repay with loss
            const loss = borrowAmount / 10n;
            const totalRepayment = borrowAmount - loss;
            await weth.write.withdraw([loss], { account: user1.account });
            await weth.write.approve([vault.address, totalRepayment], { account: user1.account });
            await vault.write.adminRepayDebt([totalRepayment, borrowAmount, user1.account.address, true], { account: user1.account });

            // Repay checks
            const wethBalancesAfterRepay = await takeBalanceSnapshot(
                publicClient, weth.address, user1.account.address, vaultAdmin.account.address, vault.address
            );
            const assetsPerShareAfter = await vault.read.convertToAssets([parseEther("1")]);
            const totalAssetsAfterRepay = await vault.read.totalAssets();
            const userDebtAfterRepay = await vault.read.adminBorrowerDebt([user1.account.address]);
            expect(assetsPerShareAfter).to.be.lt(assetsPerShareBefore, "Assets per share should decrease due to loss");
            expect(totalAssetsAfterRepay).to.equal(totalAssetsBefore - loss, "Total assets should decrease by loss amount");
            expect(wethBalancesAfterRepay.get(vault.address)).to.equal(
                wethBalancesAfterBorrow.get(vault.address) + borrowAmount - loss,
                "Vault WETH balance should be increased by debt repaid, minus loss"
            );
            expect(wethBalancesAfterRepay.get(user1.account.address)).to.equal(
                wethBalancesBefore.get(user1.account.address),
                "User1 WETH balance should be back to where it started"
            );
            expect(userDebtAfterRepay).to.equal(0n, "Admin borrower debt should be cleared");
            const adminDebtRepaidEvents = await vault.getEvents.AdminDebtRepaid();
            expect(adminDebtRepaidEvents).to.have.lengthOf(1, "AdminDebtRepaid event not emitted");
            const adminDebtRepaidEvent = adminDebtRepaidEvents[0].args;
            expect(adminDebtRepaidEvent.debtor).to.equal(getAddress(user1.account.address));
            expect(adminDebtRepaidEvent.debtRepaid).to.equal(borrowAmount);
            expect(adminDebtRepaidEvent.interestPaid).to.equal(0n);
        });
    });

    describe("Dust cleaning", function () {
        it("Clean dust from vault", async function () {
            const {
                user1,
                owner,
                vaultAdmin,
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
            await weth.write.deposit({ value: dust, account: vaultAdmin.account });
            await weth.write.approve([vault.address, dust], { account: vaultAdmin.account });
            await vault.write.donate([dust], { account: vaultAdmin.account });

            // Check distorting effect of dust
            const sharesPerEthBefore = await vault.read.convertToShares([parseEther("1")]);
            expect(sharesPerEthBefore).to.equal(parseEther("0.5"));

            // Clean dust
            await vault.write.cleanDust({ account: vaultAdmin.account });

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
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");
        })

        it("Only vault admin can borrow with adminBorrow", async function () {
            const {vault, user1, owner} = await loadFixture(deployLongPoolMockEnvironment);

            await expect(vault.write.adminBorrow(
                [user1.account.address, 1n],
                { account: user1.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");

            await expect(vault.write.adminBorrow(
                [owner.account.address, 1n],
                { account: owner.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");
        })

        it("Only vault admin or debtor can repay with adminRepayDebt", async function () {
            const {vault, weth, user1, user2, owner, vaultAdmin} = await loadFixture(deployLongPoolMockEnvironment);

            const borrowAmount = parseEther("1");
            await vault.write.adminBorrow([user1.account.address, borrowAmount], { account: vaultAdmin.account });

            await expect(vault.write.adminRepayDebt(
                [borrowAmount, borrowAmount, user1.account.address, false],
                { account: user2.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");

            await expect(vault.write.adminRepayDebt(
                [borrowAmount, borrowAmount, user1.account.address, false],
                { account: owner.account }
            )).to.be.rejectedWith("AccessManagerUnauthorizedAccount");

            const repayAmount = borrowAmount / 2n;
            await weth.write.approve([vault.address, repayAmount], { account: user1.account });
            await expect(vault.write.adminRepayDebt(
                [repayAmount, repayAmount, user1.account.address, false],
                { account: user1.account })
            ).to.be.fulfilled;

            await weth.write.transfer([vaultAdmin.account.address, repayAmount], { account: user1.account });
            await weth.write.approve([vault.address, repayAmount], { account: vaultAdmin.account });
            await expect(vault.write.adminRepayDebt(
                [repayAmount, repayAmount, user1.account.address, false],
                { account: vaultAdmin.account })
            ).to.be.fulfilled;
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

        it("Deposits cannot exceed cap", async function () {
            const {vault, owner, user1, weth} = await loadFixture(deployLongPoolMockEnvironment);

            // Owner already deposited in fixture
            const shares = await vault.read.balanceOf([owner.account.address]);
            const assets = await vault.read.convertToAssets([shares]);

            expect(await vault.read.maxDeposit([user1.account.address])).to.equal(maxUint256);

            // Set the deposit cap to 2x the current assets
            await vault.write.setDepositCap([assets * 2n], { account: owner.account });

            expect(await vault.read.maxDeposit([user1.account.address])).to.equal(assets);

            await expect(vault.write.depositEth(
                [user1.account.address], 
                { value: assets + 1n, account: user1.account }
            )).to.be.rejectedWith("ERC4626ExceededMaxDeposit");

            await weth.write.deposit({ value: assets + 1n, account: user1.account });
            await weth.write.approve([vault.address, assets + 1n], { account: user1.account });

            await expect(vault.write.deposit(
                [assets + 1n, user1.account.address], 
                { account: user1.account }
            )).to.be.rejectedWith("ERC4626ExceededMaxDeposit");
        });

        it("Cannot repay more than debt with adminRepayDebt", async function () {
            const {vault, user1, vaultAdmin} = await loadFixture(deployLongPoolMockEnvironment);

            const borrowAmount = parseEther("1");
            await vault.write.adminBorrow([user1.account.address, borrowAmount], { account: vaultAdmin.account });

            const repayAmount = borrowAmount + 1n;
            await expect(vault.write.adminRepayDebt(
                [repayAmount, repayAmount, user1.account.address, false],
                { account: user1.account }
            )).to.be.rejectedWith("AmountExceedsDebt");
        })
    });
});
