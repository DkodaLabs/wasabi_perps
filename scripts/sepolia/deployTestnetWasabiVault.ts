import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";

import PerpTokens from "../sepoliaPerpTokens.json";
import { verifyContract } from "../../utils/verifyContract";

interface PerpToken {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  image_url: string;
  nft_address: string;
  pair_address: string;
  mainnet_address: string;
}

async function main() {
  const shortPoolAddress = "0x29D47Eb1bc6965F193eC0FaD6d419f7a6Bb49A5C";
  const shortPool = await hre.viem.getContractAt("WasabiShortPool", shortPoolAddress);
  const addressProvider = await shortPool.read.addressProvider();

  for (let i = 0; i < PerpTokens.length; i++) {
    const token = PerpTokens[i];
    console.log(`[${i + 1}/${PerpTokens.length}] Deploying Vault For ${token.address}...`);
    console.log(`------------ 1. Deploying ${token.name} WasabiVault...`);
    const contractName = "WasabiVault";
    const WasabiVault = await hre.ethers.getContractFactory(contractName);
    const name = `Wasabi ${token.symbol} Vault`;
    const address =
        await hre.upgrades.deployProxy(
            WasabiVault,
            [shortPool.address, addressProvider, token.address, name, `w${token.symbol}`],
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
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
