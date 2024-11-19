import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const currentAddress = getAddress("0xEe5c45DCB0064f9B097edBC5d8adfcE23baaC03b");
  const weth = getAddress("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2");
  const swapRouter = getAddress("0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45");
  const feeReceiver = getAddress("0x97165754beA07D70Ab27C2A9E02728c79ED80d64");
  const feeBips = 25n;
  const WasabiRouter = await hre.ethers.getContractFactory("WasabiRouter");
  
  console.log("1. Upgrading WasabiRouter...");
  const address =
    await hre.upgrades.upgradeProxy(
      currentAddress,
      WasabiRouter
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`WasabiRouter upgraded to ${address}`);

  await verifyContract(address);

  const wasabiRouter = await hre.viem.getContractAt("WasabiRouter", address);
  console.log("2. Setting WETH...");
  await wasabiRouter.write.setWETH([weth]);

  console.log("3. Setting swapRouter...");
  await wasabiRouter.write.setSwapRouter([swapRouter]);

  console.log("4. Setting feeReceiver...");
  await wasabiRouter.write.setFeeReceiver([feeReceiver]);

  console.log("5. Setting withdrawFeeBips...");
  await wasabiRouter.write.setWithdrawFeeBips([feeBips]);

  console.log("Finished setting up WasabiRouter");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
