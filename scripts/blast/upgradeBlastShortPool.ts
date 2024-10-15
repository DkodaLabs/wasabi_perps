import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { getBlast, getBlastSepolia } from "./utils";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const {config} = await getBlast();

  const shortPoolAddress = "0x0301079DaBdC9A2c70b856B2C51ACa02bAc10c3a";

  console.log("1. Upgrading BlastShortPool...");
  const BlastShortPool = await hre.ethers.getContractFactory("BlastShortPool");
  const address =
    await hre.upgrades.upgradeProxy(
      shortPoolAddress,
      BlastShortPool,
      { redeployImplementation: "always" }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`BlastShortPool upgraded to ${address}`);

  await delay(5_000);
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
