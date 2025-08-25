import { getAddress } from "viem";
import hre from "hardhat";
import WasabiVaults from "../baseVaults.json";
import { CONFIG } from "../config";
import { verifyContract } from "../../../utils/verifyContract";

async function main() {
  const strategy = "0x34eed929842fc1596cad063b23d2ea68263b09aa";
  const AaveStrategy = await hre.ethers.getContractFactory("AaveStrategy");

  console.log(`Upgrading AaveStrategy for ${strategy}...`);
  await hre.upgrades.upgradeProxy(strategy, AaveStrategy);
  console.log(`  AaveStrategy upgraded`);

  await delay(5_000);

  console.log("------------ Verifying contract...");
  await verifyContract(strategy);
  console.log(`------------------------ Contract ${strategy} verified`);

  await delay(5_000);
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
