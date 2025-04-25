import { Address, getAddress } from "viem";
import hre from "hardhat";
import { verifyContract } from "../../utils/verifyContract";

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deployer address:", deployer.address);

    // Deploy BSRRecovery implementation
    const BSRRecovery = await hre.ethers.getContractFactory("BSRRecovery");

    // Get starting nonce
    const startingNonce = await deployer.getNonce();
    console.log("Starting nonce:", startingNonce);

    // Set target nonce
    const targetNonce = 11_826;
    const targetAddress = "0x3A76684Ab84fa2c8c3fA1919726777d662ce2e8E";

    // Burn nonces
    let nonce = startingNonce;
    // delay(1000);
    // console.log("Burning nonces...");
    // let i = 0;

    // while (nonce < targetNonce) {
    //     if (computeContractAddress(deployer.address, nonce).toLowerCase() === targetAddress.toLowerCase()) {
    //         console.log("Precomputed target address earlier than expected at nonce: ", nonce);
    //         break;
    //     }
    //     console.log("Burning nonce: ", nonce);
    //     const sendingNonce = nonce;
    //     deployer.sendTransaction({ to: deployer.address, value: 0n, gasLimit: 21000, data: "0x", nonce })
    //       .then((tx) => console.log("Transaction sent:", sendingNonce, tx.hash))
    //       .catch((error) => console.error("Error sending transaction for nonce:", sendingNonce, error));
    //     nonce++;

    //     i++;

    //     if (i % 20 === 0) {
    //         console.log("Waiting for 10 seconds...");
    //         await delay(5_000);
    //     }
    // }

    // console.log("Reached target nonce: ", nonce);

    // Confirm that the precomputed target address is now the target address
    // const nextAddress = computeContractAddress(deployer.address, nonce);
    // console.log("Next address: ", nextAddress);
    // console.log("Target address: ", targetAddress);

    // if (nextAddress.toLowerCase() !== targetAddress.toLowerCase()) {
    //     console.log("Target address not reached at expected nonce: ", nonce);
    //     // process.exit(1);
    // } else {
    //     console.log("!!!!! Target address reached at expected nonce: ", nonce);
    // }

    // const deployedContract = await BSRRecovery.deploy();
    // await delay(1000);
    // const address = await deployedContract.getAddress();
    // console.log("BSRRecovery deployed at:", address);

    // console.log("Verifying contract...");
    // await verifyContract(address as Address);

    // const token = "0xbd3601d32ab6fa8d693ac13c4ae245228c7ea0bb";

    // Fetch ERC20 balance of 0xbd3601d32ab6fa8d693ac13c4ae245228c7ea0bb from the token above
    // const tokenContract = await hre.ethers.getContractAt("IERC20", token);
    // const balance = await tokenContract.balanceOf("0x3a76684ab84fa2c8c3fa1919726777d662ce2e8e");
    // console.log("Balance of 0x3a76684ab84fa2c8c3fa1919726777d662ce2e8e:", balance);
    // console.log("Balance of 0x3a76684ab84fa2c8c3fa1919726777d662ce2e8e:", hre.ethers.formatUnits(balance, 18));

    console.log("Done")
}

function delay(ms: number) {
  return new Promise( resolve => setTimeout(resolve, ms) );
}

function computeContractAddress(sender: string, nonce: number): string {
  const senderBytes = hre.ethers.getBytes(sender);
  const nonceBytes = nonce === 0 ? new Uint8Array([]) : hre.ethers.getBytes(hre.ethers.toBeHex(nonce));
  const rlpEncoded = hre.ethers.encodeRlp([senderBytes, nonceBytes]);
  const contractAddressLong = hre.ethers.keccak256(rlpEncoded);
  return "0x" + contractAddressLong.slice(-40); // last 20 bytes
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});