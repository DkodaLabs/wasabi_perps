import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { getBlast, getBlastSepolia } from "./utils";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const {config} = await getBlastSepolia();

  const longPoolAddress = "0x046299143A880C4d01a318Bc6C9f2C0A5C1Ed355";

  console.log("1. Upgrading BlastLongPool...");
  const BlastLongPool = await hre.ethers.getContractFactory("BlastLongPool");
  const address =
    await hre.upgrades.upgradeProxy(
      longPoolAddress,
      BlastLongPool,
      {
        redeployImplementation: "always"
      }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`BlastLongPool upgraded to ${address}`);

  await verifyContract(address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
