import { getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

import WasabiVaults from "./mainnetVaults.json";
import { CONFIG } from "./config";

async function main() {
  console.log("1. Upgrading Vaults...");
  const manager = CONFIG.perpManager;
  const WasabiVault = await hre.ethers.getContractFactory("WasabiVault");
  const TimelockWasabiVault = await hre.ethers.getContractFactory("TimelockWasabiVault");

  for (let i = 0; i < WasabiVaults.length; i++) {
    const vault = WasabiVaults[i];
    console.log(`[${i + 1} / ${WasabiVaults.length}] - Upgrading WasabiVault ${vault.name}...`);
    const timelockWasabiVault = await hre.viem.getContractAt("TimelockWasabiVault", getAddress(vault.address));
    let contractFactory = WasabiVault;
    try {
      await timelockWasabiVault.read.getCooldownDuration();
      console.log(`  ${vault.name} is a timelock vault`);
      contractFactory = TimelockWasabiVault;
    } catch (error) {
      // console.log(`  ${vault.name} is not a timelock vault`);
    }
    let needsOwnerTransfer = false;
    const owner = await timelockWasabiVault.read.owner();
    if (owner !== manager) {
      console.log(`  ${vault.name} is not owned by the manager, owner is ${owner}`);
      needsOwnerTransfer = true;
    }

    try {
      const feebps = await timelockWasabiVault.read.interestFeeBips();
      console.log(`  ${vault.name} interest fee bips: ${feebps} | Skipping upgrade`);
      continue;
    } catch (error) {
    }

    let address =
      await hre.upgrades.upgradeProxy(
          vault.address,
          contractFactory,
          {
            call: {
              fn: needsOwnerTransfer ? "setInterestFeeBipsAndTransferOwner" : "setInterestFeeBips",
              args: needsOwnerTransfer ? [1000, manager] : [1000]
            }
          }
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);

    await delay(10_000);

    const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(address));
    console.log(`${i + 1}/${WasabiVaults.length} - WasabiVault ${vault.name} upgraded to ${implAddress}`);

    await delay(1_000);
    await verifyContract(address);
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
