import { getAddress } from "viem";
import hre from "hardhat";

const VAULT_BOOST_MANAGER = "0xB75aA3908a836F4503d65333206924F549b628e5";
const TOKEN = "0x2A0bFFbE8Fbb19e8CBf1059Ce6Db7d35160C4c87";
const BOOST_INDEX = 2n;

async function main() {
  const vaultBoostManager = await hre.viem.getContractAt(
    "VaultBoostManager",
    getAddress(VAULT_BOOST_MANAGER)
  );

  console.log(
    `Cancelling boost index ${BOOST_INDEX} for token ${getAddress(TOKEN)}...`
  );
  const txHash = await vaultBoostManager.write.cancelBoost([
    getAddress(TOKEN),
    BOOST_INDEX
  ]);
  console.log(`Cancel boost tx sent: ${txHash}`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
