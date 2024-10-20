import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

import WasabiVaults from "./mainnetVaults.json";

async function main() {

  console.log("1. Upgrading WasabiVaults...");
  const WasabiVault = await hre.ethers.getContractFactory("WasabiVault");

  const longPoolAddress = "0x8e0edfd6d15f858adbb41677b82ab64797d5afc0";
  const shortPoolAddress = "0x0fdc7b5ce282763d5372a44b01db65e14830d8ff";
  const addressProviderAddress = "0x2b04347413918588b81782cc446524354a15ee72";

  for (let i = 0; i < WasabiVaults.length; i++) {
    const vault = WasabiVaults[i];
    let feesToKeep: bigint;
    if (vault.symbol === "wWETH") {
      feesToKeep = 640118000000000000n; // TODO: calculate this using the script we prepared
    } else {
      feesToKeep = 0n;
    }
    const address =
      await hre.upgrades.upgradeProxy(
          vault.address,
          WasabiVault,
          {
            redeployImplementation: i == 0 ? "always" : undefined,
            call: {
              fn: "migrate",
              args: [
                longPoolAddress, 
                shortPoolAddress,
                addressProviderAddress,
                feesToKeep
              ]
            }
          }
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
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
