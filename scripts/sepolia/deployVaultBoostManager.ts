import { getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";
import { delay } from "../utils";

async function main() {
  const config = CONFIG;

  const shortPoolAddress = config.shortPool;
  const perpManagerAddress = config.perpManager;

  console.log("1. Deploying VaultBoostManager...");
  const VaultBoostManager = await hre.ethers.getContractFactory("VaultBoostManager");
  const vaultBoostManagerAddress = 
    await hre.upgrades.deployProxy(
        VaultBoostManager, 
        [perpManagerAddress, shortPoolAddress],
        { kind: 'uups' }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`VaultBoostManager deployed to ${vaultBoostManagerAddress}`);

  await delay(10_000);
  await verifyContract(vaultBoostManagerAddress, []);
  console.log("Done")
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
  