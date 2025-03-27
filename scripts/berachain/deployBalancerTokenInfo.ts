import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
    const bexVault = "0x4Be03f781C497A489E3cB0287833452cA9B9E80B";

    console.log("1. Deploying BalancerTokenInfo contract...");

    const BalancerTokenInfo = await hre.ethers.getContractFactory("BalancerTokenInfo");
    const address = 
      await hre.upgrades.deployProxy(
        BalancerTokenInfo,
        [bexVault],
        { kind: 'uups'})
      .then(c => c.waitForDeployment())
      .then(c => c.getAddress()).then(getAddress);
    console.log(`BalancerTokenInfo deployed to ${address}`);

    await delay(10_000);
    console.log("2. Verifying contract...");
    await verifyContract(address);
    console.log("BalancerTokenInfo verified");
}

function delay(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});