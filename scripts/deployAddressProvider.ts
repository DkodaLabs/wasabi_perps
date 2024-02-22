import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../utils/verifyContract";

async function main() {
  const debtControllerAddress = "0xb52BAbD89eEDBeF6242784DC5c60C1E609538D06";

  const feeReceiver = "0x129320410d1F827597Befcb01Dc7a037c7fbA6d5";
  const wethAddress = "0x7Dc0cF91524f536c2Bd125E7F5b0dD78D969800E";

  console.log("2. Deploying AddressProvider...");
  const addressProvider = 
    await hre.viem.deployContract(
        "AddressProvider",
        [debtControllerAddress, feeReceiver, wethAddress]);
  console.log(`AddressProvider deployed to ${addressProvider.address}`);

  await delay(10_000);
  await verifyContract(addressProvider.address, [debtControllerAddress, feeReceiver, wethAddress]);
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
