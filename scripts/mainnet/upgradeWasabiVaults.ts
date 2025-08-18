import { getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

import WasabiVaults from "./mainnetVaults.json";

async function main() {
  console.log("1. Upgrading Vaults...");
  const manager = "0xc0b01a4f4A4459D5A7E13C2E8566CDe93A010e7D"
  const WasabiVault = await hre.ethers.getContractFactory("WasabiVault");
  const TimelockWasabiVault = await hre.ethers.getContractFactory("TimelockWasabiVault");

  for (let i = 0; i < WasabiVaults.length; i++) {
    const vault = WasabiVaults[i];
    console.log(`  Upgrading WasabiVault ${vault.name}...`);
    const timelockWasabiVault = await hre.viem.getContractAt("TimelockWasabiVault", getAddress(vault.address));
    let isTimelockVault = false;
    let contractFactory = WasabiVault;
    try {
      await timelockWasabiVault.read.getCooldownDuration();
      console.log(`  ${vault.name} is a timelock vault`);
      isTimelockVault = true;
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

    await delay(10_000);
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
