import { Address } from "viem";

export interface ChainConfig {
    chainId: number;
    longPool: Address;
    shortPool: Address;
    addressProvider: Address;
    weth: Address;
}