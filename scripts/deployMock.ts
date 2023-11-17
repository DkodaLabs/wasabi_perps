import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";

async function main() {
  console.log("1. Deploying MockSwap...");
  const mockSwap = await hre.viem.deployContract("MockSwap");
  console.log(`MockSwap deployed to ${mockSwap.address}`);

  console.log("2. Deploying MockERC20...");
  const uPPG = await hre.viem.deployContract("MockERC20", ["μPudgyPenguins", 'μPPG']);
  console.log(`MockERC20 deployed to ${uPPG.address}`);

  console.log("3. Minting 50 μPPG to MockSwap...");
  await uPPG.write.mint([mockSwap.address, parseEther("10")]);
  console.log(`Minted 50 μPPG to MockSwap`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
