import { getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";
import { delay } from "../utils";
import { VAULT_ADMIN_ROLE } from "../../test/utils/constants";

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

  console.log("2. Granting VAULT_ADMIN_ROLE role to VaultBoostManager...");
  const perpManager = await hre.viem.getContractAt("PerpManager", perpManagerAddress);
  await perpManager.write.grantRole([VAULT_ADMIN_ROLE, vaultBoostManagerAddress, 0]);
  console.log("VAULT_ADMIN_ROLE role granted");
  
  console.log("Done")
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
  