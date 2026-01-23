import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";
import { delay } from "../utils";

async function main() {
  const vaultBoostManagerAddress = CONFIG.vaultBoostManager;
  if (!vaultBoostManagerAddress) {
    throw new Error("VaultBoostManager address is not set in the config");
  }
  const VaultBoostManager = await hre.ethers.getContractFactory("VaultBoostManager");

  console.log("1. Upgrading VaultBoostManager...");
  const address =
    await hre.upgrades.upgradeProxy(
      vaultBoostManagerAddress,
      VaultBoostManager
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  
  await verifyContract(address);

  await delay(10_000);

  const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(address));
  console.log(`VaultBoostManager upgraded to ${implAddress}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});