import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";
import { getAddress } from "viem";

async function main() {
  const config = CONFIG;
  const wasabiAgent = "0xa80055548FA21C81CCa4431061ab3bd02c498C55";

  console.log("1. Deploying WasabiACPAccountFactory...");
  const WasabiACPAccountFactory = await hre.ethers.getContractFactory("WasabiACPAccountFactory");
  const address = 
      await hre.upgrades.deployProxy(
          WasabiACPAccountFactory,
          [config.perpManager, wasabiAgent],
          { kind: 'uups' }
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
  console.log(`WasabiACPAccountFactory deployed to ${address}`);

  await delay(10_000);
  await verifyContract(address, []);

  console.log("Done")
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