import {
    loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { getAddress, parseEther } from "viem";
import { deployPoolsAndRouterMockEnvironment } from "./fixtures";
import { signOpenPositionRequest } from "./utils/SigningUtils";
import { getBalance, takeBalanceSnapshot } from "./utils/StateUtils";

describe("WasabiRouter", function () {
    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            const { wasabiRouter, manager } = await loadFixture(deployPoolsAndRouterMockEnvironment);
            expect(await wasabiRouter.read.owner()).to.equal(getAddress(manager.address));
        });

        it("Should set the right pool addresses", async function () {
            const { wasabiRouter, wasabiLongPool, wasabiShortPool } = await loadFixture(deployPoolsAndRouterMockEnvironment);
            expect(await wasabiRouter.read.longPool()).to.equal(getAddress(wasabiLongPool.address));
            expect(await wasabiRouter.read.shortPool()).to.equal(getAddress(wasabiShortPool.address));
        });

        it("Should set the right EIP712 domain", async function () {
            const { wasabiRouter } = await loadFixture(deployPoolsAndRouterMockEnvironment);
            const [, name, version, , verifyingContract] = await wasabiRouter.read.eip712Domain();
            expect(name).to.equal("WasabiRouter");
            expect(version).to.equal("1");
            expect(getAddress(verifyingContract)).to.equal(getAddress(wasabiRouter.address));
        });
    });

    describe("Open Position w/ Vault Deposits", function () {
        it("Long Position", async function () {
            const { sendRouterLongOpenPositionRequest, user1, orderExecutor, wethVault, wethAddress, uPPG, wasabiLongPool, publicClient, executionFee, totalAmountIn } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            // Deposit into WETH Vault
            await wethVault.write.depositEth(
                [user1.account.address], 
                { value: parseEther("50"), account: user1.account }
            );

            const wethBalancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wethVault.address, orderExecutor.account.address);
            const poolPPGBalanceBefore = await getBalance(publicClient, uPPG.address, wasabiLongPool.address);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const orderExecutorBalanceBefore = await publicClient.getBalance({ address: orderExecutor.account.address });
            const userVaultSharesBefore = await wethVault.read.balanceOf([user1.account.address]);
            const expectedSharesSpent = await wethVault.read.convertToShares([totalAmountIn + executionFee]);

            const {position, gasUsed} = await sendRouterLongOpenPositionRequest();

            const wethBalancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wethVault.address, orderExecutor.account.address);
            const poolPPGBalanceAfter = await getBalance(publicClient, uPPG.address, wasabiLongPool.address);
            const userBalanceAfter = await publicClient.getBalance({ address: user1.account.address });
            const orderExecutorBalanceAfter = await publicClient.getBalance({ address: orderExecutor.account.address });
            const userVaultSharesAfter = await wethVault.read.balanceOf([user1.account.address]);
            
            expect(orderExecutorBalanceAfter).to.equal(orderExecutorBalanceBefore - gasUsed, "Order signer should have spent gas");
            expect(userBalanceAfter).to.equal(userBalanceBefore, "User should not have spent gas");
            expect(wethBalancesAfter.get(user1.account.address)).to.equal(wethBalancesBefore.get(user1.account.address), "User should not have spent WETH from their account");
            expect(wethBalancesAfter.get(wethVault.address)).to.equal(
                wethBalancesBefore.get(wethVault.address) - position.principal - position.downPayment - position.feesToBePaid - executionFee, 
                "Principal, down payment and fees should have been transferred from WETH vault"
            );
            expect(poolPPGBalanceAfter).to.equal(poolPPGBalanceBefore + position.collateralAmount, "Pool should have received uPPG collateral");
            expect(userVaultSharesAfter).to.equal(userVaultSharesBefore - expectedSharesSpent, "User's vault shares should have been burned");
            expect(wethBalancesAfter.get(orderExecutor.account.address)).to.equal(wethBalancesBefore.get(orderExecutor.account.address) + executionFee, "Fee receiver should have received execution fee");
        })

        it("Short Position", async function () {
            const { sendRouterShortOpenPositionRequest, user1, orderExecutor, wethVault, wethAddress, wasabiShortPool, publicClient, executionFee, totalAmountIn } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            // Deposit into WETH Vault
            await wethVault.write.depositEth(
                [user1.account.address], 
                { value: parseEther("50"), account: user1.account }
            );

            const wethBalancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, wethVault.address, orderExecutor.account.address);
            const userBalanceBefore = await publicClient.getBalance({ address: user1.account.address });
            const orderExecutorBalanceBefore = await publicClient.getBalance({ address: orderExecutor.account.address });
            const userVaultSharesBefore = await wethVault.read.balanceOf([user1.account.address]);
            const expectedSharesSpent = await wethVault.read.convertToShares([totalAmountIn + executionFee]);

            const {position, gasUsed} = await sendRouterShortOpenPositionRequest();

            const wethBalancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wasabiShortPool.address, wethVault.address, orderExecutor.account.address);
            const userBalanceAfter = await publicClient.getBalance({ address: user1.account.address });
            const orderExecutorBalanceAfter = await publicClient.getBalance({ address: orderExecutor.account.address });
            const userVaultSharesAfter = await wethVault.read.balanceOf([user1.account.address]);
            
            expect(orderExecutorBalanceAfter).to.equal(orderExecutorBalanceBefore - gasUsed, "Order signer should have spent gas");
            expect(userBalanceAfter).to.equal(userBalanceBefore, "User should not have spent gas");
            expect(wethBalancesAfter.get(user1.account.address)).to.equal(wethBalancesBefore.get(user1.account.address), "User should not have spent WETH from their account");
            expect(wethBalancesAfter.get(wethVault.address)).to.equal(wethBalancesBefore.get(wethVault.address) - totalAmountIn - executionFee, "WETH down payment + fees should have been transferred from WETH vault");
            expect(wethBalancesAfter.get(wasabiShortPool.address)).to.equal(wethBalancesBefore.get(wasabiShortPool.address) + position.collateralAmount + position.feesToBePaid, "WETH collateral should have been transferred to short pool");
            expect(userVaultSharesAfter).to.equal(userVaultSharesBefore - expectedSharesSpent, "User's vault shares should have been burned");
            expect(wethBalancesAfter.get(orderExecutor.account.address)).to.equal(wethBalancesBefore.get(orderExecutor.account.address) + executionFee, "Fee receiver should have received execution fee");
        });
    })

    describe("Swaps w/ Vault Deposits", function () {
        describe("Vault -> Vault", function () {
            it("Exact In", async function () {
                const { createExactInRouterSwapData, user1, wasabiRouter, wethVault, ppgVault, wethAddress, uPPG, publicClient, swapFeeBips, feeReceiver, totalAmountIn, initialPPGPrice, priceDenominator } = await loadFixture(deployPoolsAndRouterMockEnvironment);

                // Deposit into WETH Vault
                await wethVault.write.depositEth(
                    [user1.account.address], 
                    { value: parseEther("50"), account: user1.account }
                );

                const wethBalancesBefore = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wethVault.address);
                const ppgBalancesBefore = await takeBalanceSnapshot(publicClient, uPPG.address, user1.account.address, ppgVault.address, feeReceiver);
                const userWETHVaultSharesBefore = await wethVault.read.balanceOf([user1.account.address]);
                const userPPGVaultSharesBefore = await ppgVault.read.balanceOf([user1.account.address]);

                const swapCalldata = await createExactInRouterSwapData({amount: totalAmountIn, tokenIn: wethAddress, tokenOut: uPPG.address, swapFee: swapFeeBips});
                await wasabiRouter.write.swapVaultToVault(
                    [totalAmountIn, wethAddress, uPPG.address, swapCalldata],
                    { account: user1.account }
                )

                const wethBalancesAfter = await takeBalanceSnapshot(publicClient, wethAddress, user1.account.address, wethVault.address);
                const ppgBalancesAfter = await takeBalanceSnapshot(publicClient, uPPG.address, user1.account.address, ppgVault.address, feeReceiver);
                const userWETHVaultSharesAfter = await wethVault.read.balanceOf([user1.account.address]);
                const userPPGVaultSharesAfter = await ppgVault.read.balanceOf([user1.account.address]);

                expect(wethBalancesAfter.get(user1.account.address)).to.equal(wethBalancesBefore.get(user1.account.address), "User should not have spent WETH from their account");
                expect(wethBalancesAfter.get(wethVault.address)).to.equal(wethBalancesBefore.get(wethVault.address) - totalAmountIn, "User should have spent WETH from their vault deposits");
                expect(ppgBalancesAfter.get(user1.account.address)).to.equal(ppgBalancesBefore.get(user1.account.address), "User should not have received uPPG to their account");
                expect(ppgBalancesAfter.get(ppgVault.address)).to.equal(
                    ppgBalancesBefore.get(ppgVault.address) + (totalAmountIn * initialPPGPrice / priceDenominator * (10_000n - swapFeeBips) / 10_000n), 
                    "uPPG should have been deposited into the vault, minus the swap fee"
                );
                expect(ppgBalancesAfter.get(feeReceiver)).to.equal(totalAmountIn * initialPPGPrice / priceDenominator * swapFeeBips / 10_000n, "Fee receiver should have received fee in uPPG");
                expect(userWETHVaultSharesAfter).to.be.lt(userWETHVaultSharesBefore, "User should have fewer WETH Vault shares after the swap");
                expect(userPPGVaultSharesAfter).to.be.gt(userPPGVaultSharesBefore, "User should have more PPG Vault shares after the swap");
            })
        })
        
    })

    describe("Validations", function () {
        describe("Open Position Validations", function () {
            it("InvalidPool", async function () {
                const { wasabiRouter, user1, longOpenPositionRequest, longOpenSignature, uPPG } = await loadFixture(deployPoolsAndRouterMockEnvironment);
                await expect(wasabiRouter.write.openPosition([uPPG.address, longOpenPositionRequest, longOpenSignature], { account: user1.account })).to.be.rejectedWith("InvalidPool");
            });

            it("InvalidSignature", async function () {
                const { user1, orderExecutor, wasabiRouter, wasabiShortPool, wethVault, shortOpenPositionRequest, shortOpenSignature } = await loadFixture(deployPoolsAndRouterMockEnvironment);

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
                const { wasabiRouter, wasabiLongPool, user1, longOpenPositionRequest, longOpenSignature, wethVault } = await loadFixture(deployPoolsAndRouterMockEnvironment);

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
                const { wasabiRouter, wasabiLongPool, user1, orderExecutor, longOpenPositionRequest, longOpenSignature } = await loadFixture(deployPoolsAndRouterMockEnvironment);

                // Do not deposit into WETH Vault

                const routerRequest = { ...longOpenPositionRequest, functionCallDataList: [] };
                const traderSignature = await signOpenPositionRequest(user1, "WasabiRouter", wasabiRouter.address, routerRequest);

                await expect(wasabiRouter.write.openPosition([wasabiLongPool.address, longOpenPositionRequest, longOpenSignature, traderSignature, 0n], { account: orderExecutor.account })).to.be.rejectedWith("ERC4626ExceededMaxWithdraw");
            });
        });
    });
});