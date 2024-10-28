import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const currentAddress = getAddress("0x4Aa5876878809057C5383D18A15d5f2a9892B7AC");
  const swapRouterAddress = getAddress("0xD0b8934c079c06e0A458A26272EE5238c1c02bCA");
  const WasabiRouter = await hre.ethers.getContractFactory("WasabiRouter");
  
  console.log("1. Upgrading WasabiRouter...");
  const address =
    await hre.upgrades.upgradeProxy(
      currentAddress,
      WasabiRouter,
      {
        call: {
          fn: "setSwapRouter",
          args: [swapRouterAddress]
        }
      }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`WasabiRouter upgraded to ${address}`);

  await verifyContract(address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
