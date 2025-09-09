import { formatEther, parseEther, getAddress, Hex, encodeFunctionData } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";

import WasabiVaults from "./sepoliaVaults.json";

async function main() {
  console.log("1. Deploying new TimelockWasabiVault implementation...");
  const newImplementation = await hre.viem.deployContract("TimelockWasabiVault");
  console.log(`   New implementation deployed to ${newImplementation.address}`);

  await delay(10_000);
  await verifyContract(newImplementation.address);

  await delay(10_000);
  console.log("2. Upgrading vaults via PerpManager...");

  const perpManager = await hre.viem.getContractAt("PerpManager", CONFIG.perpManager);
  const vaults = WasabiVaults.map((vault) => getAddress(vault.address));
  const calls: Hex[] = [
    encodeFunctionData({
      abi: newImplementation.abi,
      functionName: "setCooldownDuration",
      args: [600n] // 10 minutes
    })
  ];

  const tx = await perpManager.write.upgradeVaults([newImplementation.address, vaults, calls]);
  console.log(`   Transaction hash: ${tx}`);
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
