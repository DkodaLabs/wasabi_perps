import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const currentAddress = getAddress("0x29D47Eb1bc6965F193eC0FaD6d419f7a6Bb49A5C");
  const WasabiShortPool = await hre.ethers.getContractFactory("WasabiShortPool");

  console.log("1. Upgrading WasabiShortPool...");
  const address =
    await hre.upgrades.upgradeProxy(
      currentAddress,
      WasabiShortPool
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`WasabiShortPool upgraded to ${address}`);

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
