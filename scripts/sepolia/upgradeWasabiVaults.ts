import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";

import WasabiVaults from "./sepoliaVaults.json";

async function main() {
  const config = CONFIG;
  console.log("1. Upgrading vaults...");
  const WasabiVault = await hre.ethers.getContractFactory("WasabiVault");

  const longPoolAddress = config.longPool;
  const shortPoolAddress = config.shortPool;
  const addressProviderAddress = config.addressProvider;
  const longPool = await hre.viem.getContractAt("WasabiLongPool", longPoolAddress);
  const perpManagerAddress = await longPool.read.owner();

  for (let i = 0; i < WasabiVaults.length; i++) {
    const vault = WasabiVaults[i];
    console.log(`   Upgrading ${vault.name}...`);
    const address =
      await hre.upgrades.upgradeProxy(
          vault.address,
          WasabiVault,
          {
            call: {
              fn: "transferOwnership",
              args: [
                perpManagerAddress
              ]
            }
          }
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
    const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(address));
    console.log(`WasabiVault ${vault.name} upgraded to ${implAddress}`);

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
