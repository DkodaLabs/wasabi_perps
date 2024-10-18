import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

import WasabiVaults from "./mainnetVaults.json";

async function main() {

  console.log("1. Upgrading WasabiVaults...");
  const WasabiVault = await hre.ethers.getContractFactory("WasabiVault");

  const longPoolAddress = "0xA3975155b728d656F751203e050eC86Ee011636e";
  const shortPoolAddress = "0x29D47Eb1bc6965F193eC0FaD6d419f7a6Bb49A5C";
  const addressProviderAddress = "0xc0c2da35262e088472ac25fd75d922a14952426a"; // TODO: replace with new AddressProvider from deployWasabiRouter

  for (let i = 0; i < WasabiVaults.length; i++) {
    const vault = WasabiVaults[i];
    let withdrawAmount: bigint;
    if (vault.symbol === "wWETH") {
      withdrawAmount = 13513911526656498481n; // TODO: calculate this using the script we prepared
    } else {
      withdrawAmount = 0n;
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
                withdrawAmount
              ]
            }
          }
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
    const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(address));
    console.log(`WasabiVault ${vault.name} upgraded to ${implAddress}`);

    await delay(10_000);
    await verifyContract(implAddress);
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
