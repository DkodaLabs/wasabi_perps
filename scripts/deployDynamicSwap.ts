import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";

async function main() {
  console.log("1. Deploying DynamicSwap...");
  const dynamicSwap = await hre.viem.deployContract("DynamicSwap");
  console.log(`DynamicSwap deployed to ${dynamicSwap.address}`);

  console.log("2. Fetching MockERC20...");
  const uPPG = await hre.viem.getContractAt("MockERC20", "0xc91f5553b4332714f0539c00f2b378e5a8da6292");
  console.log(`MockERC20 deployed to ${uPPG.address}`);

  console.log("3. Minting 50 μPPG to DynamicSwap...");
  await uPPG.write.mint([dynamicSwap.address, parseEther("10")]);
  console.log(`Minted 50 μPPG to DynamicSwap`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
