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
                createClosePositionOrder,
                wasabiLongPool,
                user1,
                user2,
                vault,
                publicClient,
                wethAddress
            } = await loadFixture(deployLongPoolMockEnvironment);

            await vault.write.depositEth([user2.account.address], { value: parseEther("10"), account: user2.account });

            const sharesPerEthBefore = await vault.read.convertToShares([parseEther("1")]);

            const shares = await vault.read.balanceOf([user2.account.address]);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Close Position
            const { request, signature } = await createClosePositionOrder({position, interest: 0n });

            const hash = await wasabiLongPool.write.closePosition([true, request, signature], { account: user1.account });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;

            const ethBalanceBefore = await getBalance(publicClient, wethAddress, user2.account.address);
            
            const redeemTransaction =
                await vault.write.redeem([shares, user2.account.address, user2.account.address], { account: user2.account });

            const event = (await vault.getEvents.Withdraw())[0].args!;
            const ethBalanceAfter = await getBalance(publicClient, wethAddress, user2.account.address);
            const sharesPerEthAfter = await vault.read.convertToShares([parseEther("1")]);
            
            expect(await vault.read.balanceOf([user2.account.address])).to.equal(0n);
            expect(ethBalanceAfter - ethBalanceBefore).to.equal(event.assets);
            expect(sharesPerEthAfter).to.lessThan(sharesPerEthBefore);
        });
    });
});
