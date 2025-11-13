import { toFunctionSelector, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../../utils/verifyContract";
import { CONFIG } from "../config";

async function main() {
  const config = CONFIG;

  const longPoolAddress = config.longPool;
  const shortPoolAddress = config.shortPool;
  const perpManagerAddress = config.perpManager;

  console.log("1. Deploying ExactOutSwapperV2...");
  const ExactOutSwapperV2 = await hre.ethers.getContractFactory("ExactOutSwapperV2");
  const swapperAddress =
      await hre.upgrades.deployProxy(
          ExactOutSwapperV2,
          [perpManagerAddress, [longPoolAddress, shortPoolAddress]],
          { kind: 'uups' }
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
  console.log(`ExactOutSwapperV2 deployed to ${swapperAddress}`);

  await delay(10_000);
  await verifyContract(swapperAddress, []);

  await delay(10_000);
  console.log("Done")
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