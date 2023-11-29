import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";

async function main() {
  const deployer = "0x129320410d1F827597Befcb01Dc7a037c7fbA6d5";
  const longPoolAddress = "0x978cbedb003fdb36cbff7986cfc444cdfd38c133";
  const longPool = await hre.viem.getContractAt("WasabiLongPool", longPoolAddress);
  const existingAddressProviderAddress = await longPool.read.addressProvider();
  const existingAddressProvider = await hre.viem.getContractAt("AddressProvider", existingAddressProviderAddress);
  const weth = await existingAddressProvider.read.getWethAddress();

  console.log("1. Deploying WETH WasabiVault...");
  const contractName = "WasabiVault";
  const WasabiVault = await hre.ethers.getContractFactory(contractName);
  const address = 
      await hre.upgrades.deployProxy(
          WasabiVault,
          [longPool.address, existingAddressProviderAddress, weth, 'WasabiEthVault', 'wasabiETH'],
          { kind: 'uups'}
      )
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
  const vault = await hre.viem.getContractAt(contractName, address);
  console.log(`WasabiVault dedployed to ${address}`);

  console.log("4. Setting vault in pool...");
  await longPool.write.addVault([vault.address]);
  console.log(`Vault ${address} added to pool ${longPoolAddress}`);

  console.log("5. Depositing ETH to vault...");
  const mockWeth = await hre.viem.getContractAt("MockWETH", weth);
  await mockWeth.write.mint([deployer, parseEther("100")]);
  const depositAmount = parseEther("50");
  await mockWeth.write.approve([address, depositAmount]);
  await vault.write.deposit([depositAmount, deployer]);
  console.log(`Deposited ${formatEther(depositAmount)} ETH to vault ${address}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
