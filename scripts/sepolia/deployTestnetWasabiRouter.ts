import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const deployer = "0x129320410d1F827597Befcb01Dc7a037c7fbA6d5";
  const longPoolAddress = "0xA3975155b728d656F751203e050eC86Ee011636e";
  const shortPoolAddress = "0x29D47Eb1bc6965F193eC0FaD6d419f7a6Bb49A5C";
  const perpManagerAddress = "0x2C00dbf8F9996fD41547F67222FB5774E94c72A7";

  console.log("1. Deploying WasabiRouter...");
  const WasabiRouter = await hre.ethers.getContractFactory("WasabiRouter");
  const routerAddress = 
      await hre.upgrades.deployProxy(
          WasabiRouter,
          [longPoolAddress, shortPoolAddress, perpManagerAddress],
          { kind: 'uups' }
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
  
  console.log(`WasabiRouter dedployed to ${routerAddress}`);

  await delay(10_000);
  await verifyContract(routerAddress, []);

  console.log("2. Deploying new AddressProvider...");

  const debtControllerAddress = "0x8C4ef2B6911e9b28282e0FDaA964fF136e7Cbd3a";
  const wethAddress = "0x6400C43e5dD1F713fD623d92Dc64831Dd12D3298";
  const feeReceiver = "0x129320410d1F827597Befcb01Dc7a037c7fbA6d5";
  const liquidationFeeReceiver = "0x129320410d1F827597Befcb01Dc7a037c7fbA6d5";

  const addressProvider = 
    await hre.viem.deployContract(
        "AddressProvider",
        [debtControllerAddress, routerAddress, feeReceiver, wethAddress, liquidationFeeReceiver]);
  console.log(`AddressProvider deployed to ${addressProvider.address}`);

  await delay(10_000);
  await verifyContract(addressProvider.address, [debtControllerAddress, routerAddress, feeReceiver, wethAddress, liquidationFeeReceiver]);
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