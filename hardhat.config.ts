import { config as dotEnvConfig } from "dotenv";
dotEnvConfig();

import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@nomicfoundation/hardhat-chai-matchers";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-contract-sizer"


const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.23",
    settings: {
      optimizer: {
        enabled: true,
        runs: 10000
      }
    }
  },
  networks: {
    mainnet: {
      url: process.env.MAINNET_URL || '',
      accounts: process.env.MAINNET_PRIVATE_KEY ? [process.env.MAINNET_PRIVATE_KEY] : [],
    }, 
    sepolia: {
      url: process.env.SEPOLIA_URL || '',
      accounts: process.env.SEPOLIA_PRIVATE_KEY ? [process.env.SEPOLIA_PRIVATE_KEY] : [],
    }, 
    "blast-sepolia": {
      url: process.env.BLAST_SEPOLIA_URL || '',
      accounts: process.env.BLAST_SEPOLIA_PRIVATE_KEY ? [process.env.BLAST_SEPOLIA_PRIVATE_KEY] : [],
    },
    blast: {
      url: process.env.BLAST_URL || '',
      accounts: process.env.BLAST_PRIVATE_KEY ? [process.env.BLAST_PRIVATE_KEY] : [],
    }, 
    goerli: {
      url: process.env.GOERLI_URL || '',
      accounts: process.env.GOERLI_PRIVATE_KEY ? [process.env.GOERLI_PRIVATE_KEY] : [],
    }
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    outputFile: "gas-report.txt",
    noColors: true,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
    token: "ETH"
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY || '',
      sepolia: process.env.ETHERSCAN_API_KEY || '',
      blast: process.env.BLASTSCAN_API_KEY || '',
      "blast-sepolia": process.env.BLASTSCAN_API_KEY || '',
    },
    customChains: [
      {
        network: "blast-sepolia",
        chainId: 168587773,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/testnet/evm/168587773/etherscan",
          browserURL: "https://testnet.blastscan.io"
        }
      },
      {
        network: "blast",
        chainId: 81457,
        urls: {
          apiURL: "https://api.blastscan.io/api",
          browserURL: "https://blastscan.io"
        }
      }
    ]
  },
  contractSizer: {
    runOnCompile: true,
    
    only: [
      "Hash",
      "WasabiVault",
      "WasabiLongPool",
      "WasabiShortPool",
      "BlastLongPool",
      "BlastShortPool",
      "PerpUtils",
      "AddressProvider",
      "DebtController"
    ],
    except: ['/mock/']
  }
};

export default config;
