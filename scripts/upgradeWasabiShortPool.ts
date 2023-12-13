import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../utils/verifyContract";

async function main() {
  console.log("1. Upgrading WasabiShortPool...");
  const WasabiShortPool = await hre.ethers.getContractFactory("WasabiShortPool");
  const address =
    await hre.upgrades.upgradeProxy(
        "0xff38a8116c6e21886bacc8ff0db41d73cb955763",
        WasabiShortPool,
        {
          redeployImplementation: "always",
        }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`WasabiShortPool upgraded to ${address}`);

  await verifyContract(address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
