import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { getBlast, getBlastSepolia } from "./utils";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const {config} = await getBlastSepolia();

  const longPoolAddress = "0xb98085ffBDC81206b744898ba1415F27f8155482";

  // const longPool = await hre.viem.getContractAt("WasabiLongPool", longPoolAddress, config);
  // const existingAddressProviderAddress = await longPool.read.addressProvider();
  // const existingAddressProvider = await hre.viem.getContractAt("AddressProvider", existingAddressProviderAddress, config);
  // const weth = await existingAddressProvider.read.getWethAddress();


  // const rebasingWeth = await hre.viem.getContractAt("IERC20Rebasing", "0x4200000000000000000000000000000000000023", config);
  // const rebasingUsdc = await hre.viem.getContractAt("IERC20Rebasing", "0x4300000000000000000000000000000000000003", config);
  // const blast = await hre.viem.getContractAt("IBlast", "0x4300000000000000000000000000000000000002", config);

  // console.log(await blast.read.readClaimableYield([longPoolAddress]));
  // console.log(await rebasingWeth.read.getClaimableAmount([longPoolAddress]));

  // const longPool = await hre.viem.getContractAt("BlastLongPool", longPoolAddress, config);
  // await longPool.write.claimYield();
  // console.log(await rebasingUsdc.read.getClaimableAmount([longPoolAddress]));

  console.log("1. Upgrading BlastLongPool...");
  const BlastLongPool = await hre.ethers.getContractFactory("BlastLongPool");
  const address =
    await hre.upgrades.upgradeProxy(
      longPoolAddress,
      BlastLongPool,
      {
        redeployImplementation: "always"
      }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`BlastLongPool upgraded to ${address}`);

  await verifyContract(address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
