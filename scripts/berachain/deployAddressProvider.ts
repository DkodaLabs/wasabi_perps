import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const debtControllerAddress = "0x93F287F2c3FD9FdE49373afd3E6E679D7A9350F9";
  const wasabiRouter = "0x7864d8C34BfCDBd83FDA2DA917aa6175a4a4b237";
  const feeReceiver = "0x5C629f8C0B5368F523C85bFe79d2A8EFB64fB0c8";
  const wethAddress = "0x6969696969696969696969696969696969696969";
  const liquidationFeeReceiver = "0xF6336dd76300524Ef382FA9FC861305A37b929b6";
  const stakingAccountFactory = "0x1e5c9aa12b37393bcdecbbee0892830561c15d1a"

  console.log("2. Deploying AddressProvider...");
  const addressProvider = 
    await hre.viem.deployContract(
        "AddressProvider",
        [
            debtControllerAddress, 
            wasabiRouter,
            feeReceiver, 
            wethAddress, 
            liquidationFeeReceiver,
            stakingAccountFactory
        ]);
  console.log(`AddressProvider deployed to ${addressProvider.address}`);

  await delay(10_000);
  await verifyContract(addressProvider.address,
    [
        debtControllerAddress, 
        wasabiRouter,
        feeReceiver, 
        wethAddress, 
        liquidationFeeReceiver,
        stakingAccountFactory
    ]
  );
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
