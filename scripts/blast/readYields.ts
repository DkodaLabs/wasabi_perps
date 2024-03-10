import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { getBlast, getBlastSepolia } from "./utils";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const {config} = await getBlast();

  const longPoolAddress = "0x046299143A880C4d01a318Bc6C9f2C0A5C1Ed355";
  const shortPoolAddress = "0x0301079DaBdC9A2c70b856B2C51ACa02bAc10c3a";

  const rebasingWeth = await hre.viem.getContractAt("IERC20Rebasing", "0x4300000000000000000000000000000000000004", config);
  const rebasingUsdb = await hre.viem.getContractAt("IERC20Rebasing", "0x4300000000000000000000000000000000000003", config);
  const blast = await hre.viem.getContractAt("IBlast", "0x4300000000000000000000000000000000000002", config);

  console.log('------------ LONG POOL ------------')
  console.log('ETH Yield: ' + formatEther(await blast.read.readClaimableYield([longPoolAddress])));
  const gasParams = await blast.read.readGasParams([longPoolAddress]);
  console.log('Gas Earned: ' + formatEther(gasParams[1]));
  console.log('WETH Yield: ' + formatEther(await rebasingWeth.read.getClaimableAmount([longPoolAddress])));
  console.log('USDB Yield: ' + formatEther(await rebasingUsdb.read.getClaimableAmount([longPoolAddress])));

  console.log('------------ SHORT POOL ------------')
  console.log('ETH Yield: ' + formatEther(await blast.read.readClaimableYield([shortPoolAddress])));
  const gasParams2 = await blast.read.readGasParams([shortPoolAddress]);
  console.log('Gas Earned: ' + formatEther(gasParams2[1]));
  console.log('WETH Yield: ' + formatEther(await rebasingWeth.read.getClaimableAmount([shortPoolAddress])));
  console.log('USDB Yield: ' + formatEther(await rebasingUsdb.read.getClaimableAmount([shortPoolAddress])));

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
