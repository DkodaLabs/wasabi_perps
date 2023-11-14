import {
    time,
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { getAddress, parseEther } from "viem";
import { deployFeeController } from "./fixtures";

describe("FeeController", function () {

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            const { feeController, owner } = await loadFixture(deployFeeController);
            expect(await feeController.read.owner()).to.equal(getAddress(owner.account.address));
        });

        it("Should set the right fee receiver", async function () {
            const { feeController, owner } = await loadFixture(deployFeeController);
            expect(await feeController.read.getFeeReceiver()).to.equal(getAddress(owner.account.address));
        });
    });

    describe("Calculations", function () {
        it("Compute tradeValueFee", async function () {
            const { feeController, tradeFeeValue, feeDenominator } = await loadFixture(deployFeeController);

            const amount = parseEther("1").valueOf();
            const fee = amount * tradeFeeValue / feeDenominator;

            expect(await feeController.read.computeTradeFee([amount])).to.equal(fee);
        });
    });
})
