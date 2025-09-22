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

        it("Sets the right fee receiver", async function () {
            const { manager, owner, feeReceiver, liquidationFeeReceiver } = await loadFixture(deployPerpManager);
            expect(await manager.read.feeReceiver()).to.equal(getAddress(feeReceiver));
            await manager.write.setFeeReceiver([liquidationFeeReceiver], { account: owner.account });
            expect(await manager.read.feeReceiver()).to.equal(getAddress(liquidationFeeReceiver));
        });

        it("Sets the right liquidation fee receiver", async function () {
            const { manager, owner, feeReceiver, liquidationFeeReceiver } = await loadFixture(deployPerpManager);
            expect(await manager.read.liquidationFeeReceiver()).to.equal(getAddress(liquidationFeeReceiver));
            await manager.write.setLiquidationFeeReceiver([feeReceiver], { account: owner.account });
            expect(await manager.read.liquidationFeeReceiver()).to.equal(getAddress(feeReceiver));
        });

        it("Sets the right max apy", async function () {
            const { manager, owner, maxApy } = await loadFixture(deployPerpManager);
            expect(await manager.read.maxApy()).to.equal(maxApy);
            await manager.write.setMaxAPY([maxApy + 1n], { account: owner.account });
            expect(await manager.read.maxApy()).to.equal(maxApy + 1n);
        });
        
        it("Sets the right liquidation fee bps", async function () {
            const { manager, owner } = await loadFixture(deployPerpManager);
            const liquidationFeeBps = 500n;
            expect(await manager.read.liquidationFeeBps()).to.equal(liquidationFeeBps);
            await manager.write.setLiquidationFeeBps([liquidationFeeBps + 1n], { account: owner.account });
            expect(await manager.read.liquidationFeeBps()).to.equal(liquidationFeeBps + 1n);
        });
    });

    describe("Migration", function () {
        it("Migrates the contract when new variables are not yet set", async function () {
            const { owner, user1, weth, feeReceiver, liquidationFeeReceiver, wasabiRouter, partnerFeeManager } = await loadFixture(deployPoolsAndRouterMockEnvironment);
            const maxApy = 300n; // 300% APY

            // Deploy a new PerpManager without setting the AddressProvider and DebtController variables
            // to simulate a migration from a previous version of the contract
            const contractName = "PerpManager";
            const PerpManager = await hre.ethers.getContractFactory(contractName);
            const address = 
                await hre.upgrades.deployProxy(
                    PerpManager,
                    [
                        zeroAddress, // _wasabiRouter
                        zeroAddress, // _feeReceiver
                        zeroAddress, // _wethAddress
                        zeroAddress, // _liquidationFeeReceiver
                        zeroAddress, // _stakingAccountFactory
                        zeroAddress, // _partnerFeeManager
                        0n // _maxApy
                    ],
                    { kind: 'uups'}
                )
                .then(c => c.waitForDeployment())
                .then(c => c.getAddress()).then(getAddress);
            const manager = await hre.viem.getContractAt(contractName, address);

            expect(await manager.read.wasabiRouter()).to.equal(zeroAddress);
            expect(await manager.read.feeReceiver()).to.equal(zeroAddress);
            expect(await manager.read.liquidationFeeReceiver()).to.equal(zeroAddress);
            expect(await manager.read.partnerFeeManager()).to.equal(zeroAddress);
            expect(await manager.read.wethAddress()).to.equal(zeroAddress);
            expect(await manager.read.maxApy()).to.equal(0n);

            // Only the owner can migrate
            await expect(manager.write.migrate([wasabiRouter.address, feeReceiver, weth.address, liquidationFeeReceiver, zeroAddress, partnerFeeManager.address, maxApy], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Cannot migrate");

            await manager.write.migrate([wasabiRouter.address, feeReceiver, weth.address, liquidationFeeReceiver, zeroAddress, partnerFeeManager.address, maxApy], { account: owner.account });

            expect(await manager.read.wasabiRouter()).to.equal(getAddress(wasabiRouter.address));
            expect(await manager.read.feeReceiver()).to.equal(getAddress(feeReceiver));
            expect(await manager.read.liquidationFeeReceiver()).to.equal(getAddress(liquidationFeeReceiver));
            expect(await manager.read.partnerFeeManager()).to.equal(getAddress(partnerFeeManager.address));
            expect(await manager.read.wethAddress()).to.equal(getAddress(weth.address));
            expect(await manager.read.maxApy()).to.equal(maxApy);
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

    describe("Validations", function () {
        it("Cannot reinitialize", async function () {
            const { manager, owner, weth } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.initialize([weth.address, weth.address, weth.address, weth.address, weth.address, weth.address, 1000n], { account: owner.account }))
                .to.be.rejectedWith("InvalidInitialization", "Cannot reinitialize");
        });

        it("Cannot migrate once initialized", async function () {
            const { manager, owner, weth } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.migrate([weth.address, weth.address, weth.address, weth.address, weth.address, weth.address, 1000n], { account: owner.account }))
                .to.be.rejectedWith("AlreadyMigrated", "Cannot migrate once initialized");
        });

        it("Cannot upgrade vaults with different input lengths", async function () {
            const { manager, owner, wethVault } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.upgradeVaults([wethVault.address, [wethVault.address], ["0x", "0x"]], { account: owner.account }))
                .to.be.rejectedWith("InvalidLength", "Cannot upgrade vaults with different input lengths");
        });

        it("Cannot upgrade PerpManager to a non-UUPS-compatible implementation", async function () {
            const { manager, owner, weth } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.upgradeToAndCall([weth.address, "0x"], { account: owner.account }))
                .to.be.rejectedWith("ERC1967InvalidImplementation", "Cannot upgrade PerpManager to a non-UUPS-compatible implementation");
        });

        it("Only admin can upgrade PerpManager", async function () {
            const { manager, user1, weth } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.upgradeToAndCall([weth.address, "0x"], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only admin can upgrade PerpManager");
        });

        it("Only admin can upgrade vaults", async function () {
            const { manager, user1, wethVault } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.upgradeVaults([wethVault.address, [wethVault.address], ["0x"]], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only admin can upgrade vaults");
        });

        it("Only vault admin can deploy vault", async function () {
            const { manager, owner, wethVault } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.deployVault([wethVault.address, "0x"], { account: owner.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only vault admin can deploy vault");
        });

        it("Only admin can set max leverage", async function () {
            const { manager, user1, weth, usdc } = await loadFixture(deployShortPoolMockEnvironment);
            const tokenPair = { tokenA: weth.address, tokenB: usdc.address };
            await expect(manager.write.setMaxLeverage([[tokenPair], [1000n]], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only admin can set max leverage");
        });

        it("Only admin can set max apy", async function () {
            const { manager, user1, maxApy } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.setMaxAPY([maxApy + 1n], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only admin can set max apy");
        });

        it("Only admin can set liquidation fee bps", async function () {
            const { manager, user1 } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.setLiquidationFeeBps([600n], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only admin can set liquidation fee bps");
        });

        it("Only admin can set liquidation threshold bps", async function () {
            const { manager, user1, weth, usdc } = await loadFixture(deployShortPoolMockEnvironment);
            const tokenPair = { tokenA: weth.address, tokenB: usdc.address };
            await expect(manager.write.setLiquidationThresholdBps([[tokenPair], [1000n]], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only admin can set liquidation threshold bps");
        });
        
        it("Only admin can set IAddressProvider addresses", async function () {
            const { manager, user1, weth } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.setWasabiRouter([weth.address], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only admin can set IAddressProvider addresses");
            await expect(manager.write.setFeeReceiver([weth.address], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only admin can set IAddressProvider addresses");
            await expect(manager.write.setLiquidationFeeReceiver([weth.address], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only admin can set IAddressProvider addresses");
            await expect(manager.write.setStakingAccountFactory([weth.address], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only admin can set IAddressProvider addresses");
            await expect(manager.write.setPartnerFeeManager([weth.address], { account: user1.account }))
                .to.be.rejectedWith("AccessManagerUnauthorizedAccount", "Only admin can set IAddressProvider addresses");
        });

        it("Cannot set IAddressProvider addresses to zero address", async function () {
            const { manager, owner } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.setFeeReceiver([zeroAddress], { account: owner.account }))
                .to.be.rejectedWith("InvalidAddress", "Cannot set feeReceiver to zero address");
            await expect(manager.write.setLiquidationFeeReceiver([zeroAddress], { account: owner.account }))
                .to.be.rejectedWith("InvalidAddress", "Cannot set liquidationFeeReceiver to zero address");
            await expect(manager.write.setStakingAccountFactory([zeroAddress], { account: owner.account }))
                .to.be.rejectedWith("InvalidAddress", "Cannot set stakingAccountFactory to zero address");
            await expect(manager.write.setPartnerFeeManager([zeroAddress], { account: owner.account }))
                .to.be.rejectedWith("InvalidAddress", "Cannot set partnerFeeManager to zero address");
        });

        it("Cannot set max leverage for zero address pair", async function () {
            const { manager, owner, weth } = await loadFixture(deployShortPoolMockEnvironment);
            const tokenPair = { tokenA: zeroAddress, tokenB: weth.address };
            await expect(manager.write.setMaxLeverage([[tokenPair], [1000n]], { account: owner.account }))
                .to.be.rejectedWith("ZeroAddress", "Cannot set max leverage for zero address pair");
        });

        it("Cannot set max leverage for identical addresses", async function () {
            const { manager, owner, weth } = await loadFixture(deployShortPoolMockEnvironment);
            const tokenPair = { tokenA: weth.address, tokenB: weth.address };
            await expect(manager.write.setMaxLeverage([[tokenPair], [1000n]], { account: owner.account }))
                .to.be.rejectedWith("IdenticalAddresses", "Cannot set max leverage for identical addresses");
        });

        it("Cannot set max leverage to 0 or above 100x", async function () {
            const { manager, owner, weth, usdc } = await loadFixture(deployShortPoolMockEnvironment);
            const tokenPair = { tokenA: weth.address, tokenB: usdc.address };
            await expect(manager.write.setMaxLeverage([[tokenPair], [0n]], { account: owner.account }))
                .to.be.rejectedWith("InvalidValue", "Cannot set max leverage to 0");
            await expect(manager.write.setMaxLeverage([[tokenPair], [10001n]], { account: owner.account }))
                .to.be.rejectedWith("InvalidValue", "Cannot set max leverage to above 100x");
        });

        it("Cannot set max apy to 0 or above 1000%", async function () {
            const { manager, owner } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.setMaxAPY([0n], { account: owner.account }))
                .to.be.rejectedWith("InvalidValue", "Cannot set max apy to 0");
            await expect(manager.write.setMaxAPY([100001n], { account: owner.account }))
                .to.be.rejectedWith("InvalidValue", "Cannot set max apy to above 1000%");
        });

        it("Cannot set liquidation fee bps to 0 or above 10%", async function () {
            const { manager, owner } = await loadFixture(deployShortPoolMockEnvironment);
            await expect(manager.write.setLiquidationFeeBps([0n], { account: owner.account }))
                .to.be.rejectedWith("InvalidValue", "Cannot set liquidation fee bps to 0");
            await expect(manager.write.setLiquidationFeeBps([1001n], { account: owner.account }))
                .to.be.rejectedWith("InvalidValue", "Cannot set liquidation fee bps to above 10%");
        });

        it("Cannot set liquidation threshold bps to 0 or above 100%", async function () {
            const { manager, owner, weth, usdc } = await loadFixture(deployShortPoolMockEnvironment);
            const tokenPair = { tokenA: weth.address, tokenB: usdc.address };
            await expect(manager.write.setLiquidationThresholdBps([[tokenPair], [0n]], { account: owner.account }))
                .to.be.rejectedWith("InvalidValue", "Cannot set liquidation threshold bps to 0");
            await expect(manager.write.setLiquidationThresholdBps([[tokenPair], [10001n]], { account: owner.account }))
                .to.be.rejectedWith("InvalidValue", "Cannot set liquidation threshold bps to above 100%");
        });

        it("Cannot set liquidation threshold bps for zero address pair", async function () {
            const { manager, owner, weth } = await loadFixture(deployShortPoolMockEnvironment);
            const tokenPair = { tokenA: zeroAddress, tokenB: weth.address };
            await expect(manager.write.setLiquidationThresholdBps([[tokenPair], [1000n]], { account: owner.account }))
                .to.be.rejectedWith("ZeroAddress", "Cannot set liquidation threshold bps for zero address pair");
            await expect(manager.write.setLiquidationThresholdBps([[tokenPair], [1000n]], { account: owner.account }))
                .to.be.rejectedWith("ZeroAddress", "Cannot set liquidation threshold bps for zero address pair");
        });
    });
});