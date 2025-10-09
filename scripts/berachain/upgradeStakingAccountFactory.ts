import { getAddress, zeroAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";

async function main() {
  const StakingAccountFactory = await hre.ethers.getContractFactory("StakingAccountFactory");

  console.log("Upgrading StakingAccountFactory...");
  const address =
    await hre.upgrades.upgradeProxy(
        CONFIG.stakingAccountFactory || zeroAddress,
        StakingAccountFactory
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
    
  await delay(5_000);
  const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(address));
  console.log(`StakingAccountFactory upgraded to ${implAddress}`);  
  
  await verifyContract(address);

  console.log("Done");
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
