import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";

async function main() {
  const perpManager = CONFIG.perpManager;
  const uniswapV2Router = "0x08292dff21e8f5ed5510a82cfca5ee141274503d";
  const uniswapV3Router = "0x08292dff21e8f5ed5510a82cfca5ee141274503d";
  const pancakeV2Router = "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb";
  const pancakeV3Router = "0x1b81D678ffb9C0263b24A97847620C99d213eB14";
  const aerodromeRouter = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
  const aerodromeSlipstreamRouter = "0xBE6D8f0d05cC4be24d5167a3eF062215bE6D18a5";

  console.log("1. Deploying MultiProtocolSwapRouter...");
  const MultiProtocolSwapRouter = await hre.ethers.getContractFactory("MultiProtocolSwapRouter");
  const address = 
      await hre.upgrades.deployProxy(
          MultiProtocolSwapRouter,
          [perpManager, uniswapV2Router, uniswapV3Router, pancakeV2Router, pancakeV3Router, aerodromeRouter, aerodromeSlipstreamRouter],
          { 
            kind: 'uups',
            unsafeAllow: ['delegatecall']
          })
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
  console.log(`MultiProtocolSwapRouter deployed to ${address}`);

  await delay(10_000);
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
