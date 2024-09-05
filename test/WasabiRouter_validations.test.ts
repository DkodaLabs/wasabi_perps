import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { getAddress, parseEther } from "viem";
import { deployRouterMockEnvironment } from "./fixtures";
import { signOpenPositionRequest } from "./utils/SigningUtils";

describe("WasabiRouter - Validations", function () {
    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            const { wasabiRouter, manager } = await loadFixture(deployRouterMockEnvironment);
            expect(await wasabiRouter.read.owner()).to.equal(getAddress(manager.address));
        });

        it("Should set the right pool addresses", async function () {
            const { wasabiRouter, wasabiLongPool, wasabiShortPool } = await loadFixture(deployRouterMockEnvironment);
            expect(await wasabiRouter.read.longPool()).to.equal(getAddress(wasabiLongPool.address));
            expect(await wasabiRouter.read.shortPool()).to.equal(getAddress(wasabiShortPool.address));
        });

        it("Should set the right EIP712 domain", async function () {
            const { wasabiRouter } = await loadFixture(deployRouterMockEnvironment);
            const [, name, version, , verifyingContract] = await wasabiRouter.read.eip712Domain();
            expect(name).to.equal("WasabiRouter");
            expect(version).to.equal("1");
            expect(getAddress(verifyingContract)).to.equal(getAddress(wasabiRouter.address));
        });
    });

    describe("Open Position Validations", function () {
        it("InvalidPool", async function () {
            const { wasabiRouter, user1, longOpenPositionRequest, longOpenSignature, uPPG } = await loadFixture(deployRouterMockEnvironment);
            await expect(wasabiRouter.write.openPosition([uPPG.address, longOpenPositionRequest, longOpenSignature], { account: user1.account })).to.be.rejectedWith("InvalidPool");
        });

        it("InvalidSignature", async function () {
            const { user1, orderExecutor, wasabiRouter, wasabiShortPool, wethVault, shortOpenPositionRequest, shortOpenSignature } = await loadFixture(deployRouterMockEnvironment);

            // Deposit into WETH Vault
            await wethVault.write.depositEth(
                [user1.account.address],
                { value: parseEther("50"), account: user1.account }
            );

            const routerRequest = { ...shortOpenPositionRequest, functionCallDataList: [] };
            const traderSignature = await signOpenPositionRequest(user1, "WasabiRouter", wasabiRouter.address, routerRequest);
            const badSignature = { ...traderSignature, v: traderSignature.v + 2 };

            await expect(wasabiRouter.write.openPosition([wasabiShortPool.address, shortOpenPositionRequest, shortOpenSignature, badSignature, 0n], { account: orderExecutor.account })).to.be.rejectedWith("InvalidSignature");
        });

        it("AccessManagerUnauthorizedAccount", async function () {
            const { wasabiRouter, wasabiLongPool, user1, longOpenPositionRequest, longOpenSignature, wethVault } = await loadFixture(deployRouterMockEnvironment);

            // Deposit into WETH Vault
            await wethVault.write.depositEth(
                [user1.account.address],
                { value: parseEther("50"), account: user1.account }
            );

            const routerRequest = { ...longOpenPositionRequest, functionCallDataList: [] };
            const traderSignature = await signOpenPositionRequest(user1, "WasabiRouter", wasabiRouter.address, routerRequest);

            await expect(wasabiRouter.write.openPosition([wasabiLongPool.address, longOpenPositionRequest, longOpenSignature, traderSignature, 0n], { account: user1.account })).to.be.rejectedWith("AccessManagerUnauthorizedAccount");
        });

        it("ERC4626ExceededMaxWithdraw", async function () {
            const { wasabiRouter, wasabiLongPool, user1, orderExecutor, longOpenPositionRequest, longOpenSignature } = await loadFixture(deployRouterMockEnvironment);

            // Do not deposit into WETH Vault

            const routerRequest = { ...longOpenPositionRequest, functionCallDataList: [] };
            const traderSignature = await signOpenPositionRequest(user1, "WasabiRouter", wasabiRouter.address, routerRequest);

            await expect(wasabiRouter.write.openPosition([wasabiLongPool.address, longOpenPositionRequest, longOpenSignature, traderSignature, 0n], { account: orderExecutor.account })).to.be.rejectedWith("ERC4626ExceededMaxWithdraw");
        });
    });
});