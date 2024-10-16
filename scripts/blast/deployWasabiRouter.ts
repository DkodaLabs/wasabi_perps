import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const longPoolAddress = "0x046299143A880C4d01a318Bc6C9f2C0A5C1Ed355";
  const shortPoolAddress = "0x0301079DaBdC9A2c70b856B2C51ACa02bAc10c3a";
  const perpManagerAddress = "0xff2CDb9cdb79A60A31188FE37Bdc6774107cc268";

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

  const debtControllerAddress = "0xe3f3Dca2Bd68cbD34b58cfc3BCd109998fCce0Ac";
  const wethAddress = "0x4300000000000000000000000000000000000004";
  const feeReceiver = "0x5C629f8C0B5368F523C85bFe79d2A8EFB64fB0c8";
  const liquidationFeeReceiver = "0xF6336dd76300524Ef382FA9FC861305A37b929b6";

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