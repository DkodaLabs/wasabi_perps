import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";

async function main() {
  const WasabiLongPool = await hre.ethers.getContractFactory("WasabiLongPool");
  console.log("1. Upgrading WasabiLongPool...");
  const address =
    await hre.upgrades.upgradeProxy(
        "0x1c06a75670f65fece12d0881ff961c9a0cf82e41",
        WasabiLongPool
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`WasabiLongPool upgraded to ${address}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
