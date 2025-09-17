import { zeroAddress, parseEther, getAddress, defineChain } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";
import { LIQUIDATOR_ROLE, ORDER_EXECUTOR_ROLE, ORDER_SIGNER_ROLE, VAULT_ADMIN_ROLE } from "../../test/utils/constants";
import { CONFIG } from "./config";

async function main() {
    // NOTE: This script is only for deploying a new PerpManager contract and upgrading the long and short pools accordingly.
    //       The initial PerpManager contract is deployed in the deployLongPool.ts script.
    
    const deployer = "0x129320410d1F827597Befcb01Dc7a037c7fbA6d5";
    const wasabiRouter = CONFIG.wasabiRouter;
    const feeReceiver = CONFIG.feeReceiver;
    const wethAddress = CONFIG.weth;
    const liquidationFeeReceiver = CONFIG.feeReceiver;
    const partnerFeeManager = CONFIG.partnerFeeManager;
    const maxApy = 300n;

    console.log("1. Deploying Perp Manager...");
    const PerpManager = await hre.ethers.getContractFactory("PerpManager");
    const perpManagerAddress = 
        await hre.upgrades.deployProxy(
            PerpManager,
            [wasabiRouter, feeReceiver, wethAddress, liquidationFeeReceiver, zeroAddress, partnerFeeManager, maxApy],
            { kind: 'uups'})
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress())
        .then(getAddress);
    console.log(`PerpManager deployed to ${perpManagerAddress}`);

    console.log("2. Verifying PerpManager...");
    await delay(10_000);
    await verifyContract(perpManagerAddress, []);
    console.log("PerpManager verified");

    const perpManager = await hre.viem.getContractAt("PerpManager", perpManagerAddress);

    console.log("3. Grant LIQUIDATOR role...");
    await perpManager.write.grantRole([LIQUIDATOR_ROLE, deployer, 0]);
    console.log("LIQUIDATOR role granted");
    
    console.log("4. Grant ORDER_SIGNER_ROLE role...");
    await perpManager.write.grantRole([ORDER_SIGNER_ROLE, deployer, 0]);
    console.log("ORDER_SIGNER_ROLE role granted");

    console.log("5. Grant ORDER_EXECUTOR_ROLE role...");
    await perpManager.write.grantRole([ORDER_EXECUTOR_ROLE, deployer, 0]);
    console.log("ORDER_EXECUTOR_ROLE role granted");

    console.log("6. Grant VAULT_ADMIN_ROLE role...");
    await perpManager.write.grantRole([VAULT_ADMIN_ROLE, deployer, 0]);
    console.log("VAULT_ADMIN_ROLE role granted");
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
