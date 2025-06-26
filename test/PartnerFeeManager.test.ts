import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import {encodeFunctionData, zeroAddress, parseEther, getAddress} from "viem";
import { expect } from "chai";
import { Position, formatEthValue, getEventPosition, PayoutType, OpenPositionRequest, FunctionCallData } from "./utils/PerpStructUtils";
import { getApproveAndSwapFunctionCallData } from "./utils/SwapUtils";
import { deployLongPoolMockEnvironment, deployPoolsAndRouterMockEnvironment } from "./fixtures";

describe("PartnerFeeManager", function () {
    it("Should manually accrue fees", async function () {
        const { partnerFeeManager, partner, owner, weth } = await loadFixture(deployLongPoolMockEnvironment);

        const feeAmount = parseEther("1");
        await weth.write.deposit({value: feeAmount});
        await weth.write.approve([partnerFeeManager.address, feeAmount], {account: owner.account});
        await partnerFeeManager.write.adminAddFees([partner.account.address, weth.address, feeAmount], {account: owner.account});

        expect(await weth.read.balanceOf([partnerFeeManager.address])).to.equal(feeAmount);

        const accruedEvents = await partnerFeeManager.getEvents.FeesAccrued();
        expect(accruedEvents).to.have.lengthOf(1);
        expect(accruedEvents[0].args.partner).to.equal(getAddress(partner.account.address));
        expect(accruedEvents[0].args.feeToken).to.equal(getAddress(weth.address));
        expect(accruedEvents[0].args.amount).to.equal(feeAmount);

        await partnerFeeManager.write.claimFees([[weth.address]], {account: partner.account});

        expect(await weth.read.balanceOf([partnerFeeManager.address])).to.equal(0);
        expect(await weth.read.balanceOf([partner.account.address])).to.equal(feeAmount);

        const claimedEvents = await partnerFeeManager.getEvents.FeesClaimed();
        expect(claimedEvents).to.have.lengthOf(1);
        expect(claimedEvents[0].args.partner).to.equal(getAddress(partner.account.address));
        expect(claimedEvents[0].args.feeToken).to.equal(getAddress(weth.address));
        expect(claimedEvents[0].args.amount).to.equal(feeAmount);
    });

    it("Should claim fees for multiple fee tokens", async function () {
        const { partnerFeeManager, partner, owner, weth, usdc } = await loadFixture(deployLongPoolMockEnvironment);

        const wethFeeAmount = parseEther("1");
        await weth.write.deposit({value: wethFeeAmount});
        await weth.write.approve([partnerFeeManager.address, wethFeeAmount], {account: owner.account});
        await partnerFeeManager.write.adminAddFees([partner.account.address, weth.address, wethFeeAmount], {account: owner.account});

        expect(await weth.read.balanceOf([partnerFeeManager.address])).to.equal(wethFeeAmount);

        const accruedWethEvents = await partnerFeeManager.getEvents.FeesAccrued();
        expect(accruedWethEvents).to.have.lengthOf(1);
        expect(accruedWethEvents[0].args.partner).to.equal(getAddress(partner.account.address));
        expect(accruedWethEvents[0].args.feeToken).to.equal(getAddress(weth.address));
        expect(accruedWethEvents[0].args.amount).to.equal(wethFeeAmount);

        const usdcFeeAmount = parseEther("100");
        await usdc.write.mint([owner.account.address, usdcFeeAmount]);
        await usdc.write.approve([partnerFeeManager.address, usdcFeeAmount], {account: owner.account});
        await partnerFeeManager.write.adminAddFees([partner.account.address, usdc.address, usdcFeeAmount], {account: owner.account});

        expect(await usdc.read.balanceOf([partnerFeeManager.address])).to.equal(usdcFeeAmount);

        const accruedUsdcEvents = await partnerFeeManager.getEvents.FeesAccrued();
        expect(accruedUsdcEvents).to.have.lengthOf(1);
        expect(accruedUsdcEvents[0].args.partner).to.equal(getAddress(partner.account.address));
        expect(accruedUsdcEvents[0].args.feeToken).to.equal(getAddress(usdc.address));
        expect(accruedUsdcEvents[0].args.amount).to.equal(usdcFeeAmount);

        await partnerFeeManager.write.claimFees([[weth.address, usdc.address]], {account: partner.account});

        expect(await weth.read.balanceOf([partnerFeeManager.address])).to.equal(0);
        expect(await weth.read.balanceOf([partner.account.address])).to.equal(wethFeeAmount);
        expect(await usdc.read.balanceOf([partnerFeeManager.address])).to.equal(0);
        expect(await usdc.read.balanceOf([partner.account.address])).to.equal(usdcFeeAmount);

        const claimedEvents = await partnerFeeManager.getEvents.FeesClaimed();
        expect(claimedEvents).to.have.lengthOf(2);
        expect(claimedEvents[0].args.partner).to.equal(getAddress(partner.account.address));
        expect(claimedEvents[0].args.feeToken).to.equal(getAddress(weth.address));
        expect(claimedEvents[0].args.amount).to.equal(wethFeeAmount);
        expect(claimedEvents[1].args.partner).to.equal(getAddress(partner.account.address));
        expect(claimedEvents[1].args.feeToken).to.equal(getAddress(usdc.address));
        expect(claimedEvents[1].args.amount).to.equal(usdcFeeAmount);
    });

    describe("Validations", function () {
        it("Should revert if the address is not a partner", async function () {
            const { partnerFeeManager, user1, owner, weth } = await loadFixture(deployLongPoolMockEnvironment);

            const feeAmount = parseEther("1");
            await weth.write.deposit({value: feeAmount});
            await weth.write.approve([partnerFeeManager.address, feeAmount], {account: owner.account});

            await expect(partnerFeeManager.write.adminAddFees(
                [user1.account.address, weth.address, feeAmount], 
                {account: owner.account}
            )).to.be.rejectedWith("AddressNotPartner");
        });
    });
});