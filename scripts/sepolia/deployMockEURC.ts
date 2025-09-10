import { formatEther, parseUnits, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const deployer = "0x129320410d1F827597Befcb01Dc7a037c7fbA6d5";
  
  console.log("1. Deploying EURC...");
  const EURC = await hre.viem.deployContract("EURC");
  console.log(`EURC deployed to ${EURC.address}`);

  console.log("2. Minting EURC...");
  await EURC.write.mint([deployer, parseUnits("2000000", 6)]);

  await verifyContract(EURC.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
