import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";
import { delay } from "../utils";

async function main() {
  const feeBips = 25n;
  const BlastRouter = await hre.ethers.getContractFactory("BlastRouter");
  
  console.log("1. Upgrading BlastRouter...");
  const address =
    await hre.upgrades.upgradeProxy(
      CONFIG.wasabiRouter,
      BlastRouter
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`BlastRouter upgraded to ${address}`);

  await verifyContract(address);

  const blastRouter = await hre.viem.getContractAt("WasabiRouter", address);

  console.log("2. Setting WETH...");
  await blastRouter.write.setWETH([CONFIG.weth]);

  await delay(5_000);

  console.log("3. Setting swapRouter...");
  await blastRouter.write.setSwapRouter([CONFIG.swapRouter]);

  await delay(5_000);

  console.log("4. Setting feeReceiver...");
  await blastRouter.write.setFeeReceiver([CONFIG.swapFeeReceiver]);

  await delay(5_000);

  console.log("5. Setting withdrawFeeBips...");
  await blastRouter.write.setWithdrawFeeBips([feeBips]);

  console.log("Finished setting up BlastRouter");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
