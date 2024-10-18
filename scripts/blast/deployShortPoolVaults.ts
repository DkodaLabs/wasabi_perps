import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";

import PerpTokens from "./blastTokens.json";
import { verifyContract } from "../../utils/verifyContract";
import { getBlast } from "./utils";

async function main() {
  const {config} = await getBlast();

  const shortPoolAddress = "0x0301079DaBdC9A2c70b856B2C51ACa02bAc10c3a";
  
  const shortPool = await hre.viem.getContractAt("BlastShortPool", shortPoolAddress, config);
  const addressProvider = await shortPool.read.addressProvider();

  for (let i = 0; i < PerpTokens.length; i++) {
    const token = PerpTokens[i];
    console.log(`[${i + 1}/${PerpTokens.length}] Deploying Vault For ${token.address}...`);
    console.log(`------------ 1. Deploying ${token.name} BlastWasabiVault...`);
    const contractName = "BlastWasabiVault";
    const BlastWasabiVault = await hre.ethers.getContractFactory(contractName);
    const name = `Spicy ${token.symbol} Vault`;
    const address =
        await hre.upgrades.deployProxy(
          BlastWasabiVault,
            [shortPool.address, addressProvider, token.address, name, `s${token.symbol}`],
            { kind: 'uups'})
            .then(c => c.waitForDeployment())
            .then(c => c.getAddress()).then(getAddress);
    console.log(`------------------------ ${name} deployed to ${address}`);

    await delay(10_000);

    console.log("------------ 2. Setting vault in pool...");
    await shortPool.write.addVault([address]);
    console.log(`------------------------ Vault ${address} added to pool ${shortPoolAddress}`);

    await delay(10_000);

    console.log("------------ 5. Verifying contract...");
    await verifyContract(address);
    console.log(`------------------------ Contract ${address} verified`);

    console.log("------------ Finished");
  }
}

function delay(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
// To run: 
// npx hardhat run scripts/deployShortPoolVaults.ts --network mainnet
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
