import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";

import PerpTokens from "./mainnetPerpTokens.json";
import { verifyContract } from "../utils/verifyContract";

async function main() {
  const shortPoolAddress = "0x0fdc7b5ce282763d5372a44b01db65e14830d8ff";
  const shortPool = await hre.viem.getContractAt("WasabiShortPool", shortPoolAddress);
  const addressProvider = await shortPool.read.addressProvider();

  for (let i = 0; i < PerpTokens.length; i++) {
    const token = PerpTokens[i];
    console.log(`[${i + 1}/${PerpTokens.length}] Deploying Vault For ${token.address}...`);
    console.log(`------------ 1. Deploying ${token.name} WasabiVault...`);
    const contractName = "WasabiVault";
    const WasabiVault = await hre.ethers.getContractFactory(contractName);
    const name = `Spicy ${token.symbol} Vault`;
    const address =
        await hre.upgrades.deployProxy(
            WasabiVault,
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
