import { formatEther, parseEther, getAddress, zeroAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";
import { delay } from "../utils";

async function main() {
    const config = CONFIG;
    
    const perpManagerAddress = config.perpManager;
    const wasabiRouter = config.wasabiRouter;
    const weth = config.weth;
    const partnerFeeManager = config.partnerFeeManager;
    const feeReceiver = config.feeReceiver;
    const liquidationFeeReceiver = config.liquidationFeeReceiver;
    const maxApy = 300n;

    const PerpManager = await hre.ethers.getContractFactory("BlastPerpManager");

    console.log("1. Upgrading PerpManager...");
    const address =
    await hre.upgrades.upgradeProxy(
      perpManagerAddress,
      PerpManager,
      {
        call: {
            fn: "migrate",
            args: [
                wasabiRouter,
                feeReceiver,
                weth,
                liquidationFeeReceiver,
                zeroAddress,    // stakingAccountFactory
                partnerFeeManager,
                maxApy
            ]
        }
      }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  
  await verifyContract(address);

  await delay(5_000);

  const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(address));
  console.log(`PerpManager upgraded to ${implAddress}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});