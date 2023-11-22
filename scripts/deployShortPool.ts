import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";

async function main() {
  const addressProvider = "0xd9A8667011A14ee6b138f5b31874923B1dC4b33A";

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
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
