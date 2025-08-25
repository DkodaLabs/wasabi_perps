import { getAddress } from "viem";
import hre from "hardhat";
import WasabiVaults from "../baseVaults.json";
import { CONFIG } from "../config";
import { verifyContract } from "../../../utils/verifyContract";

async function main() {
  const manager = CONFIG.perpManager;
  const aavePool = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
  const AaveStrategy = await hre.ethers.getContractFactory("AaveStrategy");

  for (let i = 0; i < WasabiVaults.length; i++) {
    const vault = WasabiVaults[i];
    console.log(`[${i + 1} / ${WasabiVaults.length}] - Deploying AaveStrategy for ${vault.name}...`);
    const address = 
      await hre.upgrades.deployProxy(
        AaveStrategy, 
        [vault.address, aavePool, manager],
        {
          kind: 'uups',
        }
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
    console.log(`  AaveStrategy deployed to ${address}`);

    await delay(5_000);

    console.log("------------ Verifying contract...");
    await verifyContract(address, [vault.address, aavePool, manager]);
    console.log(`------------------------ Contract ${address} verified`);

    await delay(5_000);
  }
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
