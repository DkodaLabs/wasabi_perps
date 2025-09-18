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
    const stakingAccountFactory = "0x1e5c9aa12b37393bcdecbbee0892830561c15d1a"
    const maxApy = 300n;
    const maxLeverage = 1010n;

    const PerpManager = await hre.ethers.getContractFactory("PerpManager");

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
                feeReceiver,
                stakingAccountFactory,
                partnerFeeManager,
                maxApy,
                maxLeverage
            ]
        }
      }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  
  await verifyContract(address);

  await delay(10_000);

  const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(address));
  console.log(`PerpManager upgraded to ${implAddress}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});