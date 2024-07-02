import { zeroAddress, parseEther, getAddress, defineChain } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { getBlast } from "./utils";

async function main() {
  const debtController = "0xe3f3Dca2Bd68cbD34b58cfc3BCd109998fCce0Ac";
  const {
    config, feeReceiver, wethAddress, perpManager, liquidationFeeReceiver
  } = await getBlast();

  console.log("1. Deploying AddressProvider...");
  const addressProvider = 
    await hre.viem.deployContract(
      "AddressProvider",
      [debtController, feeReceiver, wethAddress, liquidationFeeReceiver],
      config);
  console.log(`AddressProvider deployed to ${addressProvider.address}`);

  await delay(10_000);
  await verifyContract(addressProvider.address, [debtController, feeReceiver, wethAddress, liquidationFeeReceiver]);
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
