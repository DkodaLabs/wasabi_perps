import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import { encodeFunctionData, getAddress, zeroAddress } from "viem";
import { deployShortPoolMockEnvironment, deployPerpManager, deployPoolsAndRouterMockEnvironment } from "./fixtures";
import hre from "hardhat";
import { ADMIN_ROLE, LIQUIDATOR_ROLE, ORDER_SIGNER_ROLE } from "./utils/constants";

describe("PerpManager", function () {
    describe("Basic Tests", function () {
        it("Only manager can assign roles", async function () {
            const { manager, user1, owner, orderSigner, liquidator } = await loadFixture(deployPerpManager);

            let address = getAddress(user1.account.address);
            await expect(manager.write.grantRole([ADMIN_ROLE, address, 0], { account: user1.account }))
                .to.be.rejectedWith(`AccessManagerUnauthorizedAccount("${address}", ${ADMIN_ROLE})`, "Only admin can assign roles");

            address = getAddress(liquidator.account.address);
            await expect(manager.write.grantRole([ADMIN_ROLE, user1.account.address, 0], { account: liquidator.account }))
                .to.be.rejectedWith(`AccessManagerUnauthorizedAccount("${address}", ${ADMIN_ROLE})`, "Only admin can assign roles");
            await expect(manager.write.grantRole([LIQUIDATOR_ROLE, user1.account.address, 0], { account: liquidator.account }))
                .to.be.rejectedWith(`AccessManagerUnauthorizedAccount("${address}", ${ADMIN_ROLE})`, "Only admin can assign roles");

            address = getAddress(orderSigner.account.address);
            await expect(manager.write.grantRole([ADMIN_ROLE, user1.account.address, 0], { account: orderSigner.account }))
                .to.be.rejectedWith(`AccessManagerUnauthorizedAccount("${address}", ${ADMIN_ROLE})`, "Only admin can assign roles");
            await expect(manager.write.grantRole([ORDER_SIGNER_ROLE, user1.account.address, 0], { account: orderSigner.account }))
                .to.be.rejectedWith(`AccessManagerUnauthorizedAccount("${address}", ${ADMIN_ROLE})`, "Only admin can assign roles");

            await manager.write.grantRole([ADMIN_ROLE, address, 0], { account: owner.account });
            
            const event = (await manager.getEvents.RoleGranted())[0].args!;
            
            expect(event.account).to.equal(address);
            expect(event.roleId).to.equal(ADMIN_ROLE);
        });
    });

    describe("Vault management", function () {
        it("Deploys a new vault and adds it to the short pool", async function () {
            const { manager, wethVault, vaultAdmin, wasabiLongPool, wasabiShortPool } = await loadFixture(deployPoolsAndRouterMockEnvironment);

            const eurc = await hre.viem.deployContract("MockERC20", ["Euro Coin", "EURC"]);

            const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(wethVault.address));
            const data = encodeFunctionData({
                abi: wethVault.abi,
                functionName: "initialize",
                args: [wasabiLongPool.address, wasabiShortPool.address, manager.address, eurc.address, "EURC Vault", "sEURC"],
            });

            await manager.write.deployVault([implAddress, data], { account: vaultAdmin.account });

            const newVaultEvents = await wasabiShortPool.getEvents.NewVault();
            expect(newVaultEvents.length).to.equal(1);
            const vaultAddress = newVaultEvents[0].args!.vault || zeroAddress;
            const newVault = await hre.viem.getContractAt("WasabiVault", vaultAddress);

            expect(await newVault.read.owner()).to.equal(getAddress(manager.address));
            expect(await newVault.read.asset()).to.equal(getAddress(eurc.address));
            expect(await newVault.read.name()).to.equal("EURC Vault");
            expect(await newVault.read.symbol()).to.equal("sEURC");
            expect(await wasabiShortPool.read.getVault([eurc.address])).to.equal(vaultAddress);
        });
        
        it("Upgrades multiple vaults at once with different calldata for each", async function () {
            const { manager, vault, usdcVault, wethVault, owner } = await loadFixture(deployShortPoolMockEnvironment);

            const newImplementation = await hre.viem.deployContract("TimelockWasabiVault");
            const functionName = "setCooldownDuration";
            const abi = [
                {
                type: "function",
                name: functionName,
                stateMutability: "nonpayable",
                inputs: [{ name: "duration", type: "uint256" }],
                outputs: [],
                },
            ]

            const vaults = [vault.address, usdcVault.address, wethVault.address];
            
            // Encode different calls for each vault
            const calls = [
                encodeFunctionData({
                    abi,
                    functionName,
                    args: [3600n], // 1 hour for vault
                }),
                encodeFunctionData({
                    abi,
                    functionName,
                    args: [7200n], // 2 hours for usdcVault
                }),
                encodeFunctionData({
                    abi,
                    functionName,
                    args: [10800n], // 3 hours for wethVault
                }),
            ];

            await manager.write.upgradeVaults([newImplementation.address, vaults, calls], { account: owner.account });
            
            const vaultTimelock = await hre.viem.getContractAt("TimelockWasabiVault", vault.address);
            const usdcVaultTimelock = await hre.viem.getContractAt("TimelockWasabiVault", usdcVault.address);
            const wethVaultTimelock = await hre.viem.getContractAt("TimelockWasabiVault", wethVault.address);

            expect(await vaultTimelock.read.getCooldownDuration()).to.equal(3600n);
            expect(await usdcVaultTimelock.read.getCooldownDuration()).to.equal(7200n);
            expect(await wethVaultTimelock.read.getCooldownDuration()).to.equal(10800n);
        });
    });
});