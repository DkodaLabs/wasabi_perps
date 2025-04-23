import { getAddress } from "viem";
import hre from "hardhat";

async function main() {
    const [deployer] = await hre.ethers.getSigners();
    console.log("Deployer address:", deployer.address);

    // Deploy BSRRecovery implementation
    const BSRRecovery = await hre.ethers.getContractFactory("BSRRecovery");

    // Get starting nonce
    const startingNonce = await deployer.getNonce();
    console.log("Starting nonce:", startingNonce);

    // Set target nonce
    const targetNonce = 11828;
    const targetAddress = "0x3A76684Ab84fa2c8c3fA1919726777d662ce2e8E";

    // Burn nonces
    let nonce = startingNonce;
    delay(1000);
    console.log("Burning nonces...");
    while (nonce < targetNonce - 1) {
        if (computeContractAddress(deployer.address, nonce).toLowerCase() === targetAddress.toLowerCase()) {
            console.log("Precomputed target address earlier than expected at nonce: ", nonce);
            break;
        }
        await deployer.sendTransaction({ to: deployer.address, value: 0n, gasLimit: 21000, data: "0x" });
        nonce++;
    }
    console.log("Reached target nonce (minus 1): ", nonce);

    // Confirm that the precomputed target address is now the target address
    if (computeContractAddress(deployer.address, nonce + 1).toLowerCase() !== targetAddress.toLowerCase()) {
        console.log("Target address not reached at expected nonce: ", nonce);
        process.exit(1);
    }

    // Deploy BSRRecovery proxy
    const proxy = await hre.upgrades.deployProxy(BSRRecovery, [], { kind: 'uups', redeployImplementation: "always" })
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    console.log("BSRRecovery proxy deployed at:", proxy);

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