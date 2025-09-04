import { getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import BaseVaults from "./baseVaults.json";

async function main() {

  const dryRun = false;

  console.log("1. Upgrading Vaults | Dry Run:", dryRun);
  const WasabiVault = await hre.ethers.getContractFactory("WasabiVault");
  const TimelockWasabiVault = await hre.ethers.getContractFactory("TimelockWasabiVault");

  for (let i = 0; i < BaseVaults.length; i++) {
    const vault = BaseVaults[i];
    console.log(`[${i + 1}/${BaseVaults.length}] - Upgrading WasabiVault ${vault.name}...`);
    const timelockWasabiVault = await hre.viem.getContractAt("TimelockWasabiVault", getAddress(vault.address));
    let isTimelockVault = false;
    let contractFactory = WasabiVault;
    try {
      const duration = await timelockWasabiVault.read.getCooldownDuration();
      console.log(`  ${vault.name} is a timelock vault: duration: ${duration}`);
      isTimelockVault = true;
      contractFactory = TimelockWasabiVault;
    } catch (error) {
      // console.log(`  ${vault.name} is not a timelock vault`);
    }

    if (!dryRun) {
      let address =
        await hre.upgrades.upgradeProxy(
            vault.address,
            contractFactory
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
      
      const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(address));
      console.log(`[${i + 1}/${BaseVaults.length}] - WasabiVault ${vault.name} upgraded to ${implAddress}`);

      await delay(3_000);
      await verifyContract(getAddress(address));
    }
  }
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
