import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseEther } from "viem";
import { deployLongPoolMockEnvironment, deployV1PoolsMockEnvironment } from "./fixtures";
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

    describe("Upgrade to V2", function () {
        it("TVL Migration", async function () {
            const {
                wasabiLongPool,
                wasabiShortPool,
                weth,
                uPPG,
                wethVault,
                ppgVault,
                publicClient,
                user1,
                sendDefaultLongOpenPositionRequest,
                sendDefaultShortOpenPositionRequest,
                createSignedCloseLongPositionRequest,
                createSignedCloseShortPositionRequest,
                upgradeToV2
            } = await loadFixture(deployV1PoolsMockEnvironment);

            // Open positions
            const { position: longPosition } = await sendDefaultLongOpenPositionRequest();
            const { position: shortPosition } = await sendDefaultShortOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            const wethBalancesBefore = await takeBalanceSnapshot(publicClient, weth.address, wasabiLongPool.address, wasabiShortPool.address, wethVault.address);
            const ppgBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiLongPool.address, wasabiShortPool.address, ppgVault.address);

            // Upgrade vaults and pools to V2
            const { wethVaultV2, ppgVaultV2 } = await upgradeToV2(
                longPosition.feesToBePaid
            );

            const wethBalancesAfter = await takeBalanceSnapshot(publicClient, weth.address, wasabiLongPool.address, wasabiShortPool.address, wethVaultV2.address);
            const ppgBalancesAfter = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiLongPool.address, wasabiShortPool.address, ppgVaultV2.address);

            // Check that TVL has been migrated to the vaults during reinitialization
            expect(wethBalancesAfter.get(wethVaultV2.address)).to.equal(
                wethBalancesBefore.get(wasabiLongPool.address) - longPosition.feesToBePaid
            );
            expect(wethBalancesAfter.get(wasabiLongPool.address)).to.equal(longPosition.feesToBePaid);
            expect(wethBalancesAfter.get(wasabiShortPool.address)).to.equal(
                shortPosition.collateralAmount + shortPosition.feesToBePaid, 
                "Short pool should still have WETH collateral and fees"
            );
            expect(ppgBalancesAfter.get(ppgVaultV2.address)).to.equal(ppgBalancesBefore.get(wasabiShortPool.address));
            expect(ppgBalancesAfter.get(wasabiShortPool.address)).to.equal(0n);
            expect(ppgBalancesAfter.get(wasabiLongPool.address)).to.equal(
                longPosition.collateralAmount,
                "Long pool should still have PPG collateral and fees"
            );

            // Close positions
            const { request: longRequest, signature: longSignature } = await createSignedCloseLongPositionRequest({ position: longPosition });
            const { request: shortRequest, signature: shortSignature } = await createSignedCloseShortPositionRequest({ position: shortPosition });

            const longHash = await wasabiLongPool.write.closePosition([PayoutType.UNWRAPPED, longRequest, longSignature], { account: user1.account });
            const longEvents = await wasabiLongPool.getEvents.PositionClosed();
            const shortHash = await wasabiShortPool.write.closePosition([PayoutType.UNWRAPPED, shortRequest, shortSignature], { account: user1.account });
            const shortEvents = await wasabiShortPool.getEvents.PositionClosed();

            const wethBalancesFinal = await takeBalanceSnapshot(publicClient, weth.address, wasabiLongPool.address, wasabiShortPool.address, wethVaultV2.address);
            const ppgBalancesFinal = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiLongPool.address, wasabiShortPool.address, ppgVaultV2.address);

            // Check that principal and interest have been repayed to the vaults on position close
            expect(longEvents).to.have.lengthOf(1);
            expect(shortEvents).to.have.lengthOf(1);
            const longClosePositionEvent = longEvents[0].args;
            const shortClosePositionEvent = shortEvents[0].args;

            expect(wethBalancesFinal.get(wethVaultV2.address)).to.equal(wethBalancesAfter.get(wethVaultV2.address) + longClosePositionEvent.interestPaid! + longClosePositionEvent.principalRepaid!, "WETH principal and interest not repayed to vault");
            expect(ppgBalancesFinal.get(ppgVaultV2.address)).to.equal(ppgBalancesAfter.get(ppgVaultV2.address) + shortClosePositionEvent.interestPaid! + shortClosePositionEvent.principalRepaid!, "PPG principal and interest not repayed to vault");
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

        it("Can't migrate vault TVL more than once", async function () {
            const {
                wasabiLongPool,
                wasabiShortPool,
                weth,
                publicClient,
                addressProvider,
                sendDefaultLongOpenPositionRequest,
                sendDefaultShortOpenPositionRequest,
                upgradeToV2
            } = await loadFixture(deployV1PoolsMockEnvironment);

            // Open positions
            const { position: longPosition } = await sendDefaultLongOpenPositionRequest();
            await sendDefaultShortOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Upgrade vaults and pools to V2
            const wethBalanceBefore = await getBalance(publicClient, weth.address, wasabiLongPool.address);
            const { wethVaultV2, ppgVaultV2 } = await upgradeToV2(
                wethBalanceBefore - longPosition.feesToBePaid
            );

            // Try to migrate again
            await expect(wethVaultV2.write.migrate(
                [wasabiLongPool.address, wasabiShortPool.address, addressProvider.address, 0n]
            )).to.be.rejectedWith("AlreadyMigrated");
            await expect(ppgVaultV2.write.migrate(
                [wasabiLongPool.address, wasabiShortPool.address, addressProvider.address, 0n]
            )).to.be.rejectedWith("AlreadyMigrated");
        });
    });
});
