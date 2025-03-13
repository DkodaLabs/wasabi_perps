import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";

import PerpTokens from "./berachainTokens.json";
import { verifyContract } from "../../utils/verifyContract";
import { CONFIG } from "./config";

async function main() {
  const config = CONFIG;

  const longPool = await hre.viem.getContractAt("WasabiLongPool", config.longPool);
  const shortPool = await hre.viem.getContractAt("WasabiShortPool", config.shortPool);
  const perpManagerAddress = await longPool.read.owner();

  for (let i = 0; i < PerpTokens.length; i++) {
    await delay(10_000);

    const token = PerpTokens[i];
    console.log(`[${i + 1}/${PerpTokens.length}] Deploying Vault For ${token.address}...`);
    console.log(`------------ 1. Deploying ${token.name} BeraVault...`);
    const contractName = "BeraVault";
    const BeraVault = await hre.ethers.getContractFactory(contractName);
    const name = `Spicy ${token.symbol} Vault`;
    const address =
        await hre.upgrades.deployProxy(
            BeraVault,
            { kind: 'uups', initializer: false, unsafeAllow: ['missing-initializer-call']})
            .then(c => c.waitForDeployment())
            .then(c => c.getAddress()).then(getAddress);
    console.log(`------------------------ ${name} deployed to ${address}`);

    await delay(10_000);

    console.log("------------ 2. Initializing contract...");
    const vault = await hre.viem.getContractAt(contractName, address);
    await vault.write.initialize([config.longPool, config.shortPool, config.addressProvider, perpManagerAddress, getAddress(token.address), name, `s${token.symbol}`])
    console.log(`------------------------ ${name} initialized`);

    await delay(10_000);

    console.log("------------ 3. Verifying contract...");
    await verifyContract(address);
    console.log(`------------------------ Contract ${address} verified`);

    await delay(10_000);

    console.log("------------ 4. Setting vault in short pool...");
    await shortPool.write.addVault([address]);
    console.log(`------------------------ Vault ${address} added to pool ${config.shortPool}`);

    if (token.symbol === "WBERA" || token.symbol === "HONEY") {
      await delay(10_000);

      console.log("------------ 5. Setting vault in long pool...");
      await longPool.write.addVault([address]);
      console.log(`------------------------ Vault ${address} added to pool ${config.longPool}`);
    }

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
