import { zeroAddress, parseEther, getAddress } from "viem";
import hre from "hardhat";

async function main() {

  const dynamicSwap = "0xb9faf488e5ed578636cc69f3b10f25b344ea51e5";

  const tokens =
    [['μBoredApeYachtClub','μBAYC'],
    ['μMutantApeYachtClub','μMAYC'],
    ['μPotatoz','μPotatoz'],
    ['μAzuki','μAZUKI'],
    ['μDeGods','μDEGODS'],
    ['μCaptainz','μCaptainz'],
    ['μMeebits','μ⚇']];

  for (let i = 0; i < tokens.length; i++) {
    const name = tokens[i][0];
    const symbol = tokens[i][1];

    console.log(`${i + 1}A: Deploying ${name}...`);
    const token = await hre.viem.deployContract("MockERC20", [name, symbol]);
    console.log(`${name} (${symbol}) deployed to ${token.address}`);

    console.log(`${i + 1}B: Minting 2M ${symbol} to DynamicSwap...`);
    await token.write.mint([dynamicSwap, parseEther("2000000")]);
    console.log(`Minted 2M ${symbol} to DynamicSwap`);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
