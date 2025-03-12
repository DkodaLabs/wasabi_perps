import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";

async function main() {
  // TODO: Run deployLongPool.ts first, then set the addressProvider and perpManager addresses accordingly
  const addressProvider = CONFIG.addressProvider;
  const perpManager = "0x5c285Dd01440fb1175ae31934a5D1b3b90b6DD81";

  console.log("1. Deploying WasabiShortPool...");
  const WasabiShortPool = await hre.ethers.getContractFactory("WasabiShortPool");
  const address = 
      await hre.upgrades.deployProxy(
          WasabiShortPool,
          [addressProvider, perpManager],
          { kind: 'uups'})
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
  console.log(`WasabiShortPool deployed to ${address}`);

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
