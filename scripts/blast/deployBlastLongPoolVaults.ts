import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { getBlast, getBlastSepolia } from "./utils";

async function main() {
  const {config} = await getBlastSepolia();

  const longPoolAddress = "0xb98085ffBDC81206b744898ba1415F27f8155482";

  const longPool = await hre.viem.getContractAt("WasabiLongPool", longPoolAddress, config);
  const existingAddressProviderAddress = await longPool.read.addressProvider();
  const existingAddressProvider = await hre.viem.getContractAt("AddressProvider", existingAddressProviderAddress, config);
  const weth = await existingAddressProvider.read.getWethAddress();

  console.log("1. Deploying WETH WasabiVault...");
  const contractName = "BlastWasabiVault";
  const BlastWasabiVault = await hre.ethers.getContractFactory(contractName);
  const address = 
      await hre.upgrades.deployProxy(
        BlastWasabiVault,
          [longPool.address, existingAddressProviderAddress, weth, 'Wasabi WETH Vault', 'wWETH'],
          { kind: 'uups'}
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
  const vault = await hre.viem.getContractAt(contractName, address, config);
  console.log(`BlastWasabiVault deployed to ${address}`);

  console.log("2. Setting vault in pool...");
  await longPool.write.addVault([vault.address],);
  console.log(`Vault ${address} added to pool ${longPoolAddress}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
