import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../utils/verifyContract";
import PerpTokens from "./goerliPerpTokens.json";

async function main() {

  const dynamicSwap = "0x14f2f68554b60150734a96a7f91bc37916275bf7";

  for (let i = 0; i < PerpTokens.length; i++) {
    const token = PerpTokens[i];

    console.log(`${i + 1}A: Fetching ${token.name}...`);
    const tokenContract = await hre.viem.getContractAt("MockERC20", token.address);
    console.log(`${token.name} (${token.symbol}) deployed at ${token.address}`);

    console.log(`${i + 1}B: Minting 50M ${token.symbol} to DynamicSwap...`);
    await tokenContract.write.mint([dynamicSwap, parseEther("50000000")]);
    console.log(`Minted 50M ${token.symbol} to DynamicSwap`)
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
