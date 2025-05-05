import { toFunctionSelector, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";

async function main() {
  const config = CONFIG;

  const longPoolAddress = config.longPool;
  const addressProviderAddress = config.addressProvider;
  const longPool = await hre.viem.getContractAt("WasabiLongPool", longPoolAddress);
  const addressProvider = await hre.viem.getContractAt("AddressProvider", addressProviderAddress);
  const perpManagerAddress = await longPool.read.owner();
  const ibgtAddress = "0xac03caba51e17c86c921e1f6cbfbdc91f8bb2e6b";
  const infraredVaultAddress = "0x75f3be06b02e235f6d0e7ef2d462b29739168301";

  console.log("1. Deploying StakingAccountFactory...");
  const StakingAccountFactory = await hre.ethers.getContractFactory("StakingAccountFactory");
  const factoryAddress =
      await hre.upgrades.deployProxy(
          StakingAccountFactory,
          [perpManagerAddress],
          { kind: 'uups' }
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
  console.log(`StakingAccountFactory deployed to ${factoryAddress}`);

  await delay(10_000);

  console.log("2. Verifying StakingAccountFactory...");
  await verifyContract(factoryAddress, []);

  await delay(10_000);

  console.log("3. Upgrading AddressProvider...");
  const AddressProvider = await hre.ethers.getContractFactory("AddressProvider");
  const upgradedAddressProvider = 
    await hre.upgrades.upgradeProxy(
      addressProviderAddress, 
      AddressProvider, 
      { kind: 'uups' }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);

  await delay(10_000);
  const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(upgradedAddressProvider));
  console.log(`AddressProvider upgraded to ${implAddress}`);

  await delay(10_000);

  console.log("4. Verifying AddressProvider...");
  await verifyContract(upgradedAddressProvider, []);

  await delay(10_000);

  console.log("5. Adding StakingAccountFactory to AddressProvider...");
  await addressProvider.write.setStakingAccountFactory([factoryAddress]);
  console.log("StakingAccountFactory added to AddressProvider");

  await delay(10_000);

  console.log("6. Adding iBGT Infrared Vault to StakingAccountFactory...");
  const stakingAccountFactory = await hre.viem.getContractAt("StakingAccountFactory", factoryAddress);
  await stakingAccountFactory.write.setStakingContractForToken([ibgtAddress, infraredVaultAddress, 0]);

  console.log("Done")
}

function delay(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});