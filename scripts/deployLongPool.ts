import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";

async function main() {
  const tradeFeeValue = 50n; // 0.5%
  const swapFeeValue = 30n; // 0.3%
  const feeReceiver = "0x129320410d1F827597Befcb01Dc7a037c7fbA6d5";

  console.log("1. Deploying FeeController...");
  const feeController =
    await hre.viem.deployContract(
      "FeeController",
      [feeReceiver, tradeFeeValue, swapFeeValue]);
  console.log(`FeeController deployed to ${feeController.address}`);

  const maxApy = 300n; // 300% APY
  const maxLeverage = 500n; // 5x Leverage

  console.log("2. Deploying DebtController...");
  const debtController =
    await hre.viem.deployContract(
      "DebtController",
      [maxApy, maxLeverage]);
  console.log(`DebtController deployed to ${debtController.address}`);

  console.log("3. Deploying AddressProvider...");
  const addressProvider = 
    await hre.viem.deployContract(
        "AddressProvider",
        [debtController.address, feeController.address, zeroAddress]);
  console.log(`AddressProvider deployed to ${addressProvider.address}`);

  console.log("4. Deploying WasabiLongPool...");
  const WasabiLongPool = await hre.ethers.getContractFactory("WasabiLongPool");
  const address = 
      await hre.upgrades.deployProxy(
          WasabiLongPool,
          [addressProvider.address],
          { kind: 'uups'})
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
  console.log(`WasabiLongPool deployed to ${address}`);

  const [owner] = await hre.viem.getWalletClients();

  console.log("5. Sending 0.5 ETH to WasabiLongPool...");
  await owner.sendTransaction({
    to: address,
    value: parseEther("0.5")
  });
  console.log(`Sent 0.5 ETH to ${address}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
