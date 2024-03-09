import { zeroAddress, parseEther, getAddress, defineChain } from "viem";
import hre from "hardhat";
import { verifyContract } from "../utils/verifyContract";
import { LIQUIDATOR_ROLE, ORDER_SIGNER_ROLE } from "../test/utils/constants";


async function main() {

    const chain = defineChain({
      id: 81457,
      name: "blast",
      nativeCurrency: {
        name: "Ether",
        symbol: "ETH",
        decimals: 18
      },
      rpcUrls: {
        default: {
          http: ["https://holy-practical-owl.blast-mainnet.quiknode.pro/590d29b28faafbe6e3f80846cdc50e3f4c5356b0"]
        }
      }
    });

    const deployer = "0x5C629f8C0B5368F523C85bFe79d2A8EFB64fB0c8";
    const perpManagerAddress = "0xff2CDb9cdb79A60A31188FE37Bdc6774107cc268";
    // const longPool = "0x978cbedb003fdb36cbff7986cfc444cdfd38c133";
    // const shortPool = "0xff38a8116c6e21886bacc8ff0db41d73cb955763";

    // console.log("1. Deploying Perp Manager...");
    // const PerpManager = await hre.ethers.getContractFactory("PerpManager");
    // const address = 
    //     await hre.upgrades.deployProxy(
    //         PerpManager,
    //         [],
    //         { kind: 'uups'})
    //     .then(c => c.waitForDeployment())
    //     .then(c => c.getAddress())
    //     .then(getAddress);
    // console.log(`PerpManager deployed to ${address}`);

    // console.log("2. Verifying PerpManager...");
    // await delay(10_000);
    // await verifyContract(address, []);
    // console.log("PerpManager verified"););
    
    // const perpManager = await hre.viem.getContractAt("PerpManager", perpManagerAddress, {
    //   client: {
    //     public: hre.viem.getPublicClient({
    //       chain: {
    //         id:
    //       }
    //     }),
    //   }
    // });

    const walletClient = await hre.viem.getWalletClient(deployer, { chain });
    const publicClient = await hre.viem.getPublicClient({ chain });

    const perpManager = await hre.viem.getContractAt("PerpManager", perpManagerAddress, {
      client: {
        public: publicClient,
        wallet: walletClient
      }
    });

    // console.log("3. Grant LIQUIDATOR role...");
    // await perpManager.write.grantRole([LIQUIDATOR_ROLE, deployer, 0]);
    // console.log("LIQUIDATOR role granted");
    
    console.log("4. Grant ORDER_SIGNER_ROLE role...");
    await perpManager.write.grantRole([ORDER_SIGNER_ROLE, deployer, 0]);
    console.log("ORDER_SIGNER_ROLE role granted");

    // const perpManagerAddress = "0x8857e74d17a56354e4f25a120b599334ff487adb";
    
    // console.log("5. Upgrading long pool...");
    // const WasabiLongPool = await hre.ethers.getContractFactory("WasabiLongPool");
    
    // const longUpgradedAddress = await hre.upgrades.upgradeProxy(
    //     longPool,
    //     WasabiLongPool,
    //     {
    //         redeployImplementation: "always",
    //         call: { fn: "migrateToRoleManager", args: [perpManagerAddress] }
    //     })
    //     .then(c => c.waitForDeployment())
    //     .then(c => c.getAddress()).then(getAddress);
    // console.log(`WasabiLongPool upgraded to ${longUpgradedAddress}`);
    
    // console.log("6. Verifying long pool...");
    // await delay(10_000);
    // await verifyContract(longUpgradedAddress);
    // console.log("WasabiLongPool verified");

    // console.log("7. Upgrading short pool...");
    // const WasabiShortPool = await hre.ethers.getContractFactory("WasabiShortPool");

    // const shortUpgradedAddress = await hre.upgrades.upgradeProxy(
    //     shortPool,
    //     WasabiShortPool,
    //     {
    //         redeployImplementation: "always",
    //         call: { fn: "migrateToRoleManager", args: [perpManagerAddress] }
    //     })
    //     .then(c => c.waitForDeployment())
    //     .then(c => c.getAddress()).then(getAddress);
    // console.log(`WasabiShortPool upgraded to ${shortUpgradedAddress}`);

    // console.log("8. Verifying short pool...");
    // await delay(10_000);
    // await verifyContract(shortUpgradedAddress);
    // console.log("WasabiShortPool verified");
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
