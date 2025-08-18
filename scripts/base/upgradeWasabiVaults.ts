import { getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import BaseVaults from "./baseVaults.json";

async function main() {

  console.log("1. Upgrading Vaults...");
  const WasabiVault = await hre.ethers.getContractFactory("WasabiVault");

  for (let i = 0; i < BaseVaults.length; i++) {
    const vault = BaseVaults[i];
    console.log(`  Upgrading WasabiVault ${vault.name}...`);
    const address =
      await hre.upgrades.upgradeProxy(
          vault.address,
          WasabiVault,
          {
            call: {
              fn: "setInterestFeeBips",
              args: [1000]
            }
          }
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
    const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(address));
    console.log(`${i + 1}/${BaseVaults.length} - WasabiVault ${vault.name} upgraded to ${implAddress}`);

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
