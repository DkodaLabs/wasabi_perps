import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../../utils/verifyContract";
import { CONFIG } from "../config";
import { delay } from "../../utils";

async function main() {
  const swapperAddress = CONFIG.exactOutSwapper2;
  if (!swapperAddress) {
    throw new Error("exactOutSwapper2 is not defined in config");
  }
  const ExactOutSwapperV2 = await hre.ethers.getContractFactory("ExactOutSwapperV2");

  console.log("1. Upgrading ExactOutSwapperV2...");
  const address =
    await hre.upgrades.upgradeProxy(
      swapperAddress,
      ExactOutSwapperV2
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  
  await delay(3_000);

  await verifyContract(address);

  const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(address));
  console.log(`ExactOutSwapperV2 upgraded to ${implAddress}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});