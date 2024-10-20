import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

import WasabiVaults from "./blastVaults.json";

async function main() {

  console.log("1. Upgrading BlastVaults...");
  const WasabiVault = await hre.ethers.getContractFactory("BlastVault");

  const longPoolAddress = "0x046299143A880C4d01a318Bc6C9f2C0A5C1Ed355";
  const shortPoolAddress = "0x0301079DaBdC9A2c70b856B2C51ACa02bAc10c3a";
  const addressProviderAddress = "0xd47cae7085b7ac29509fb879c46ff19c2f4c8ad8";

  for (let i = 0; i < WasabiVaults.length; i++) {
    const vault = WasabiVaults[i];
    let feesToKeep: bigint;
    if (vault.symbol === "wWETH") {
      feesToKeep = 268271500000000000n;
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
