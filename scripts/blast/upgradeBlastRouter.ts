import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const currentAddress = getAddress("0x41810aa8369cde01364efbdaf8d1f4e974a352fe");
  const weth = getAddress("0x4300000000000000000000000000000000000004");
  const swapRouter = getAddress("0x789a11Ced3D407aD7CE4ADf1f7bFAf270b470773");
  const feeReceiver = getAddress("0x97165754beA07D70Ab27C2A9E02728c79ED80d64");
  const feeBips = 25n;
  const BlastRouter = await hre.ethers.getContractFactory("BlastRouter");
  
  console.log("1. Upgrading BlastRouter...");
  const address =
    await hre.upgrades.upgradeProxy(
      currentAddress,
      BlastRouter
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`BlastRouter upgraded to ${address}`);

  await verifyContract(address);

  const blastRouter = await hre.viem.getContractAt("WasabiRouter", address);
  console.log("2. Setting WETH...");
  await blastRouter.write.setWETH([weth]);

  console.log("3. Setting swapRouter...");
  await blastRouter.write.setSwapRouter([swapRouter]);

  console.log("4. Setting feeReceiver...");
  await blastRouter.write.setFeeReceiver([feeReceiver]);

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
