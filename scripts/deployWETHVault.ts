import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";

async function main() {
  const deployer = "0x129320410d1F827597Befcb01Dc7a037c7fbA6d5";
  const longPoolAddress = "0x1c06a75670f65fece12d0881ff961c9a0cf82e41";
  const longPool = await hre.viem.getContractAt("WasabiLongPool", longPoolAddress);
  const existingAddressProviderAddress = await longPool.read.addressProvider();
  // const existingAddressProvider = await hre.viem.getContractAt("AddressProvider", existingAddressProviderAddress);

  // console.log("1. Deploy WETH");
  // const weth = await hre.viem.deployContract("WETH9");
  // console.log(`WETH deployed to ${weth.address}`);

  // console.log("2. Deploying AddressProvider...");
  // const addressProvider = 
  //   await hre.viem.deployContract(
  //       "AddressProvider",
  //       [
  //         await existingAddressProvider.read.debtController(),
  //         await existingAddressProvider.read.feeController(),
  //         weth.address
  //       ]);
  // console.log(`AddressProvider deployed to ${addressProvider.address}`);

  // console.log("2b. Setting new AddressProvider...");
  // await longPool.write.setAddressProvider([addressProvider.address]);

  // console.log("3. Deploying WETH WasabiVault...");
  const contractName = "WasabiVault";
  // const WasabiVault = await hre.ethers.getContractFactory(contractName);
  // const address = 
  //     await hre.upgrades.deployProxy(
  //         WasabiVault,
  //         [longPool.address, existingAddressProviderAddress, "0x773eec89bda7215e76f096705ae6f57b6c74ad95", 'WasabiEthVault', 'wasabiETH'],
  //         { kind: 'uups'}
  //     )
  //     .then(c => c.waitForDeployment())
  //     .then(c => c.getAddress()).then(getAddress);
  const vault = await hre.viem.getContractAt(contractName, "0x240dafbfd85c1f6f8ddc7de2deae40c0c597c242");
  // console.log(`WasabiVault dedployed to ${address}`);

  // console.log("4. Setting vault in pool...");
  // await longPool.write.addVault([vault.address]);
  // console.log(`Vault ${address} added to pool ${longPoolAddress}`);

  console.log("5. Depositing ETH to vault...");
  const depositAmount = parseEther("10");
  await vault.write.depositEth([deployer], { value: depositAmount });
  console.log(`Deposited ${formatEther(depositAmount)} ETH to vault ${"0x240dafbfd85c1f6f8ddc7de2deae40c0c597c242"}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
