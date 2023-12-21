import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../utils/verifyContract";

async function main() {
  console.log("1. Upgrading WasabiShortPool...");
  const WasabiShortPool = await hre.ethers.getContractFactory("WasabiShortPool");
  const address =
    await hre.upgrades.upgradeProxy(
        "0x0fdc7b5ce282763d5372a44b01db65e14830d8ff",
        WasabiShortPool,
        {
          redeployImplementation: "always",
        }
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
