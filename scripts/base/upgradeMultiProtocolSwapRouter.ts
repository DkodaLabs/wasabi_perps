import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";

async function main() {
  const multiProtocolSwapRouterAddress = "0x186ef3bf61c337b4048bb71bfcaf85cf95044a86";
  const MultiProtocolSwapRouter = await hre.ethers.getContractFactory("MultiProtocolSwapRouter");

  console.log("1. Upgrading MultiProtocolSwapRouter...");
  const address =
    await hre.upgrades.upgradeProxy(
      multiProtocolSwapRouterAddress,
      MultiProtocolSwapRouter,
      {
        redeployImplementation: 'always',
      }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`MultiProtocolSwapRouter upgraded to ${address}`);

  await delay(10_000);
  await verifyContract(address);
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
