import { getAddress, parseEther } from "viem";
import hre from "hardhat";
import { delay } from "../../utils";

const VAULT_BOOST_MANAGER = "0xB75aA3908a836F4503d65333206924F549b628e5";
const TOKEN = "0x2A0bFFbE8Fbb19e8CBf1059Ce6Db7d35160C4c87";
const START_TIMESTAMP = 1768938658n;
const DURATION = 86400n * 14n;

async function main() {
  const vaultBoostManager = await hre.viem.getContractAt(
    "VaultBoostManager",
    getAddress(VAULT_BOOST_MANAGER)
  );
  const token = await hre.viem.getContractAt(
    "IERC20",
    getAddress(TOKEN)
  );

  console.log(`Approving tokens to vault boost manager...`);
  await token.write.approve([vaultBoostManager.address, parseEther("10000")]);

  await delay(10_000);

  console.log(
    `Initiating vault boost for token ${getAddress(TOKEN)}...`
  );
  const txHash = await vaultBoostManager.write.initiateBoost([
    getAddress(TOKEN),
    parseEther("10000"),
    START_TIMESTAMP,
    DURATION
  ]);
  console.log(`Initiate vault boost tx sent: ${txHash}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
