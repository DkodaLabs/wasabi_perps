import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { getAddress } from "viem";
import { deployLongPoolMockEnvironment } from "./fixtures";
import hre from "hardhat";

describe("WasabiLongPool - Proxy Validations", function () {
    describe("Upgrade Contract", function () {
        it("Upgrade and call new function", async function () {
            const { wasabiLongPool, user1, owner, } = await loadFixture(deployLongPoolMockEnvironment);

            const contractName = "MockWasabiLongPoolV2";
            const MockWasabiLongPoolV2 = await hre.ethers.getContractFactory(contractName);
            const address = 
                await hre.upgrades.upgradeProxy(
                    wasabiLongPool.address,
                    MockWasabiLongPoolV2,
                    { call: { fn: "setSomeNewValue", args: [42] } }
                )
                .then(c => c.waitForDeployment())
                .then(c => c.getAddress()).then(getAddress);
            const wasabiLongPool2 = await hre.viem.getContractAt(contractName, address);

            expect(await wasabiLongPool2.read.someNewValue()).to.equal(42);

            await expect(wasabiLongPool2.write.setSomeNewValue([43n], {account: user1.account.address}))
                .to.be.rejectedWith(`OwnableUnauthorizedAccount("${getAddress(user1.account.address)}")`, "Only owner can set address provider");

            await wasabiLongPool2.write.setSomeNewValue([43n], {account: owner.account.address});
            expect(await wasabiLongPool2.read.someNewValue()).to.equal(43);
        });

        it("Can't upgrade implementation contract", async function () {
            const {implAddress, addressProvider, user1 , wasabiLongPool} = await loadFixture(deployLongPoolMockEnvironment);

            const wasabiLongPoolImpl = await hre.viem.getContractAt("WasabiLongPool", implAddress);

            expect(wasabiLongPool.address).to.not.equal(wasabiLongPoolImpl.address);

            await expect(wasabiLongPoolImpl.write.initialize([addressProvider.address], {account: user1.account.address}))
                .to.be.rejectedWith("InvalidInitialization");
        });
    });
});