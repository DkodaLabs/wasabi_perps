import { getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
  const factoryAddress = "0x72e1e4dc16853c4d0dc63dc03ed09ed50c1d61c8";

  console.log("1. Deploying new WasabiACPAccount implementation...");
  const WasabiACPAccount = await hre.ethers.getContractFactory("WasabiACPAccount");
  const wasabiACPAccountImplAddress = await WasabiACPAccount.deploy()
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);

  await delay(10_000);
  await verifyContract(wasabiACPAccountImplAddress);

  console.log("2. Upgrading WasabiACPAccountFactory...");
  const WasabiACPAccountFactory = await hre.ethers.getContractFactory("WasabiACPAccountFactory");
  const address =
    await hre.upgrades.upgradeProxy(
        factoryAddress,
        WasabiACPAccountFactory,
        {
          call: {
            fn: "upgradeBeacon",
            args: [wasabiACPAccountImplAddress]
          }
        }
    )
    .then(c => c.waitForDeployment())
    .then(c => c.getAddress()).then(getAddress);
    
  await delay(10_000);
  const implAddress = getAddress(await hre.upgrades.erc1967.getImplementationAddress(address));
  console.log(`WasabiACPAccountFactory upgraded to ${implAddress}`);  
  
  await verifyContract(address);

  await delay(10_000);
  console.log("Done");
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
