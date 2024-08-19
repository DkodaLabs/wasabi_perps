import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const currentAddress = getAddress("0xa3975155b728d656f751203e050ec86ee011636e");
  const WasabiLongPool = await hre.ethers.getContractFactory("WasabiLongPool");
  
  console.log("1. Upgrading WasabiLongPool...");
  const address =
    await hre.upgrades.upgradeProxy(
      currentAddress,
      WasabiLongPool
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`WasabiLongPool upgraded to ${address}`);

  await verifyContract(address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
