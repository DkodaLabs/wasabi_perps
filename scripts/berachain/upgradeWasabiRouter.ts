import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";
import { delay } from "../utils";

async function main() {
  const WasabiRouter = await hre.ethers.getContractFactory("WasabiRouter");
  
  console.log("1. Upgrading WasabiRouter...");
  const address =
    await hre.upgrades.upgradeProxy(
      CONFIG.wasabiRouter,
      WasabiRouter,
      {
        call: {
          fn: "setWhitelistedFunctionSelectors",
          args: [
            [
              // Uniswap
              "0xac9650d8", // multicall(bytes[])
              "0x472b43f3", // swapExactTokensForTokens(uint256,uint256,address[],address)
              "0x42712a67", // swapTokensForExactTokens(uint256,uint256,address[],address)
              "0x04e45aaf", // exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
              "0xb858183f", // exactInput((bytes,address,uint256,uint256))
              "0x5023b4df", // exactOutputSingle((address,address,uint24,address,uint256,uint256,uint160))
              "0x09b81346", // exactOutput((bytes,address,uint256,uint256))
              // OpenOcean
              "0x90411a32", // swap(address,(address,address,address,address,uint256,uint256,uint256,uint256,address,bytes),(uint256,uint256,uint256,bytes)[])
              // Odos
              "0x83bd37f9", // swapCompact()
              "0x30f80b4c", // swap((address,uint256,address,address,uint256,uint256,address),bytes,address,(uint64,uint64,address))
              // KyberSwap
              "0xe21fd0e9", // swap((address,address,bytes,SwapDescriptionV2,bytes))
            ], 
            true
          ]
        }
      }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
  console.log(`WasabiRouter upgraded to ${address}`);

  await verifyContract(address);

  await delay(5_000);

  console.log("Finished setting up WasabiRouter");
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
