import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../utils/verifyContract";

import WasabiVaults from "./mainnetVaults.json";

async function main() {
  console.log("1. Upgrading WasabiVaults...");
  const WasabiVault = await hre.ethers.getContractFactory("WasabiVault");

  for (let i = 2; i < WasabiVaults.length; i++) {
    const vault = WasabiVaults[i];
    const address =
      await hre.upgrades.upgradeProxy(
          vault.address,
          WasabiVault
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
    console.log(`WasabiVault ${vault.name} upgraded to ${address}`);

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
