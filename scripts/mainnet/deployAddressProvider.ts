import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const debtControllerAddress = "0xFe7B8F5722ac881242e16beBc8Ea0B28c3EE60C2";

  const feeReceiver = "0x5C629f8C0B5368F523C85bFe79d2A8EFB64fB0c8";
  const wethAddress = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const liquidationFeeReceiver = "0xF6336dd76300524Ef382FA9FC861305A37b929b6";

  console.log("2. Deploying AddressProvider...");
  const addressProvider = 
    await hre.viem.deployContract(
        "AddressProvider",
        [debtControllerAddress, feeReceiver, wethAddress, liquidationFeeReceiver]);
  console.log(`AddressProvider deployed to ${addressProvider.address}`);

  await delay(10_000);
  await verifyContract(addressProvider.address, [debtControllerAddress, feeReceiver, wethAddress, liquidationFeeReceiver]);
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
