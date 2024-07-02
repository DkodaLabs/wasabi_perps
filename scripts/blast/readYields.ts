import { formatEther, parseEther, getAddress, Address } from "viem";
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

  const allVaults = [
    "0x09c885de423eab752bfead9de203c9fe8c33082a",
    "0x14f86c94d260489c73df7ceeb45205d5bff0d13a",
    "0x18412f323aede6786993a3f42828e817b4a876b7",
    "0x237e604e8a946df3332bfa318191d72895f80144",
    "0x2cb60ad6fb60355d41fd848034c85e20740acce2",
    "0x3336f14ad8c9731352d4323212d86d231dae1558",
    "0x3563b4f9a60474a392dab6f188effff3688f9e9a",
    "0x3ccdbd9336711894126b5f7fc4f26d4547e768ad",
    "0x4bed2a922654cacc2be974689619768fabf24855",
    "0x5c0f73ced4b7caf05ee46385c548acb77389b5a7",
    "0x6b4d371a557c2b5987fcbcc7b841819bb919303c",
    "0x7274aa6606e7c3afabc6ba3e7e345c03eee7fe81",
    "0x73ec6a715805236176de2468318f6920efed9d74",
    "0x7eda4afad0764dbe971ed3e0884ec3196ecacccf",
    "0x8e2b50413a53f50e2a059142a9be060294961e40",
    "0x9e31ef400c74630ab50066dd64c29c1f4fc57209",
    "0x9eea5bdb09670c2def6c338bf1cf4f477c48be22",
    "0xba74ab0bdc17d085dae189499e4d23a124d46c1a",
    "0xc8061516994aa5d884fdf6385c6b64e7b9e93014",
    "0xcc082c5fe2919fefaa5356386717b2c7c30d7ab5",
    "0xcc3eed7dec4471086ac8eb6f799bd1095e56d34a",
    "0xf2abb552eb3c8a8a580c22558ad7fbeb34a6af53",
    "0x1e046bc49eeebd0f5633caa9638fe977cfdaf0c8"
  ]
  

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
  for (const i in allVaults) {
    const vaultAddress = allVaults[i] as Address;
    // const vault = await hre.viem.getContractAt("BlastWasabiVault", vaultAddress, config);
    // await vault.simulate.claimAllGas
    console.log('Vault: ' + vaultAddress);
    gasParams = await blast.read.readGasParams([vaultAddress]);
    totalGas += gasParams[1];
    console.log('Gas Earned: ' + formatEther(gasParams[1]));
  };

  console.log('------------ TOTAL ------------');
  console.log('Total Gas Earned: ' + formatEther(totalGas));
  console.log('Total Extra ETH Yield: ' + formatEther(extraEthYield + extraWethYield));
  console.log('Total Extra USDB Yield: ' + formatEther(extraUSDBYield));

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
