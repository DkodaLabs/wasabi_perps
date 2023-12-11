import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../utils/verifyContract";

async function main() {
  console.log("1. Deploying UniswapV3FromV2Quoter...");
  const quoter = await hre.viem.deployContract("UniswapV3FromV2Quoter", ["0xed1f6473345f45b75f8179591dd5ba1888cf2fb3"]);
  console.log(`UniswapV3FromV2Quoter deployed to ${quoter.address}`);

  await verifyContract(quoter.address,);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
