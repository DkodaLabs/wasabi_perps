import { formatEther, parseEther, getAddress } from "viem";
import hre from "hardhat";

import PerpTokens from "./goerliPerpTokens.json";
import { verifyContract } from "../utils/verifyContract";

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
  const deployer = "0x129320410d1F827597Befcb01Dc7a037c7fbA6d5";
  const shortPoolAddress = "0xFD348413de008cE27880687E825bcaf2e7Fa4d28";
  const shortPool = await hre.viem.getContractAt("WasabiShortPool", shortPoolAddress);
  const addressProvider = await shortPool.read.addressProvider();
  const amount = parseEther("10000000");

  for (let i = 6; i < PerpTokens.length; i++) {
    const token = PerpTokens[i];
    console.log(`[${i + 1}/${PerpTokens.length}] Deploying Vault For ${token.address}...`);
    console.log(`------------ 1. Deploying${token.name} WasabiVault...`);
    const contractName = "WasabiVault";
    const WasabiVault = await hre.ethers.getContractFactory(contractName);
    const name = `Wasabi ${token.name}Vault`;
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

    console.log("------------ 3. Minting tokens for vault...");
    const tokenContract = await hre.viem.getContractAt("MockERC20", token.address);
    await tokenContract.write.mint([deployer, amount]);

    console.log("------------ 4. Approving tokens to vault...");
    await tokenContract.write.approve([address, amount]);

    await delay(10_000);

    console.log("------------ 5. Verifying contract...");
    await verifyContract(address);
    console.log(`------------------------ Contract ${address} verified`);

    await delay(20_000);

    console.log("------------ 6. Depositing tokens to vault...");
    const vault = await hre.viem.getContractAt(contractName, address);
    await vault.write.deposit([amount, deployer]);

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
