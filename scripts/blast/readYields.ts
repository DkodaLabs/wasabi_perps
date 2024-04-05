import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { getBlast, getBlastSepolia } from "./utils";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const {config} = await getBlast();

  const longPoolAddress = "0x046299143A880C4d01a318Bc6C9f2C0A5C1Ed355";
  const shortPoolAddress = "0x0301079DaBdC9A2c70b856B2C51ACa02bAc10c3a";

  let totalGas = 0n;

  const usdbVault = "0x4bed2a922654cacc2be974689619768fabf24855";
  const ethVault = "0x8e2b50413a53f50e2a059142a9be060294961e40";

  const rebasingWeth = await hre.viem.getContractAt("IERC20Rebasing", "0x4300000000000000000000000000000000000004", config);
  const rebasingUsdb = await hre.viem.getContractAt("IERC20Rebasing", "0x4300000000000000000000000000000000000003", config);
  const blast = await hre.viem.getContractAt("IBlast", "0x4300000000000000000000000000000000000002", config);

  const extraEthYield = await blast.read.readClaimableYield([shortPoolAddress]);
  const extraWethYield = await rebasingWeth.read.getClaimableAmount([shortPoolAddress]);
  const extraUSDBYield = await rebasingUsdb.read.getClaimableAmount([longPoolAddress]);

  console.log('------------ LONG POOL ------------')
  let gasParams = await blast.read.readGasParams([longPoolAddress]);
  totalGas += gasParams[1];
  console.log('Gas Earned: ' + formatEther(gasParams[1]));
  console.log('ETH Yield: ' + formatEther(await blast.read.readClaimableYield([longPoolAddress])));
  console.log('WETH Yield: ' + formatEther(await rebasingWeth.read.getClaimableAmount([longPoolAddress])));
  console.log('USDB Yield: ' + formatEther(extraUSDBYield));

  console.log('------------ SHORT POOL ------------')
  gasParams = await blast.read.readGasParams([shortPoolAddress]);
  totalGas += gasParams[1];
  console.log('Gas Earned: ' + formatEther(gasParams[1]));
  console.log('ETH Yield: ' + formatEther(extraEthYield));
  console.log('WETH Yield: ' + formatEther(extraWethYield));
  console.log('USDB Yield: ' + formatEther(await rebasingUsdb.read.getClaimableAmount([shortPoolAddress])));

  console.log('------------ VAULTS ------------');
  console.log('ETH Vault');
  gasParams = await blast.read.readGasParams([ethVault]);
  totalGas += gasParams[1];
  console.log('Gas Earned: ' + formatEther(gasParams[1]));

  console.log('USDB Vault');
  gasParams = await blast.read.readGasParams([usdbVault]);
  totalGas += gasParams[1];
  console.log('Gas Earned: ' + formatEther(gasParams[1]));

  console.log('------------ TOTAL ------------');
  console.log('Total Gas Earned: ' + formatEther(totalGas));
  console.log('Total Extra ETH Yield: ' + formatEther(extraEthYield + extraWethYield));
  console.log('Total Exstra USDB Yield: ' + formatEther(extraUSDBYield));

  // const longPool = await hre.viem.getContractAt("BlastLongPool", longPoolAddress, config);
  // await longPool.write.claimYield();
  // console.log(await rebasingUsdc.read.getClaimableAmount([longPoolAddress]));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
