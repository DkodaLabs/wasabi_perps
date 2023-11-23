import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../utils/verifyContract";

async function main() {
  const WasabiShortPool = await hre.ethers.getContractFactory("WasabiShortPool");
  console.log("1. Upgrading WasabiShortPool...");
  const address =
    await hre.upgrades.upgradeProxy(
        "0xFD348413de008cE27880687E825bcaf2e7Fa4d28",
        WasabiShortPool
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
