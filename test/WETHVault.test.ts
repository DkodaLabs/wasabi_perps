import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { zeroAddress, parseEther } from "viem";
import { getValueWithoutFee } from "./utils/PerpStructUtils";
import { getApproveAndSwapFunctionCallData } from "./utils/SwapUtils";
import { deployLongPoolMockEnvironment } from "./fixtures";
import { getBalance, takeBalanceSnapshot } from "./utils/StateUtils";

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
            } = await loadFixture(deployLongPoolMockEnvironment);

            await vault.write.depositEth([user2.account.address], { value: parseEther("10"), account: user2.account });

            const sharesPerEthBefore = await vault.read.convertToShares([parseEther("1")]);

            const shares = await vault.read.balanceOf([user2.account.address]);

            // Open Position
            const {position} = await sendDefaultOpenPositionRequest();

            await time.increase(86400n); // 1 day later

            // Close Position
            const { request, signature } = await createClosePositionOrder({position, interest: 0n });

            const hash = await wasabiLongPool.write.closePosition([request, signature], { account: user1.account });

            // Checks
            const events = await wasabiLongPool.getEvents.PositionClosed();
            expect(events).to.have.lengthOf(1);
            const closePositionEvent = events[0].args;

            const ethBalanceBefore = await getBalance(publicClient, zeroAddress, user2.account.address);
            
            const redeemTransaction =
                await vault.write.redeem([shares, user2.account.address, user2.account.address], { account: user2.account });

            const event = (await vault.getEvents.Withdraw())[0].args!;
            const ethBalanceAfter = await getBalance(publicClient, zeroAddress, user2.account.address);
            const gasUsed = await publicClient.getTransactionReceipt({hash: redeemTransaction}).then(r => r.gasUsed * r.effectiveGasPrice);
            const sharesPerEthAfter = await vault.read.convertToShares([parseEther("1")]);
            
            expect(await vault.read.balanceOf([user2.account.address])).to.equal(0n);
            expect(ethBalanceAfter - ethBalanceBefore + gasUsed).to.equal(event.assets);
            expect(sharesPerEthAfter).to.lessThan(sharesPerEthBefore);
        });
    });
});
