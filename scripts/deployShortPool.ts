import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../utils/verifyContract";

async function main() {
  const addressProvider = "0x4c95cd183f44e69d7de638474c8e44e99557fda5";

  console.log("1. Deploying WasabiShortPool...");
  const WasabiShortPool = await hre.ethers.getContractFactory("WasabiShortPool");
  const address = 
      await hre.upgrades.deployProxy(
          WasabiShortPool,
          [addressProvider],
          { kind: 'uups'})
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
  console.log(`WasabiShortPool deployed to ${address}`);

  await verifyContract(address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
