import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { parseEther } from "viem";
import { deployLongPoolMockEnvironment, deployWasabiPoolsMockEnvironment } from "./fixtures";
import { getBalance, takeBalanceSnapshot } from "./utils/StateUtils";

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
            } = await loadFixture(deployWasabiPoolsMockEnvironment);

            // Open positions
            const { position: longPosition } = await sendDefaultLongOpenPositionRequest();
            const { position: shortPosition } = await sendDefaultShortOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            const wethBalancesBefore = await takeBalanceSnapshot(publicClient, weth.address, wasabiLongPool.address, wasabiShortPool.address, wethVault.address);
            const ppgBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, wasabiLongPool.address, wasabiShortPool.address, ppgVault.address);

            // Upgrade vaults and pools to V2
            const { wethVaultV2, ppgVaultV2 } = await upgradeToV2(
                wethBalancesBefore.get(wasabiLongPool.address) - longPosition.feesToBePaid
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

            const longHash = await wasabiLongPool.write.closePosition([true, longRequest, longSignature], { account: user1.account });
            const longEvents = await wasabiLongPool.getEvents.PositionClosed();
            const shortHash = await wasabiShortPool.write.closePosition([true, shortRequest, shortSignature], { account: user1.account });
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
});
