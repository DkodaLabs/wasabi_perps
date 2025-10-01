import { Address } from "viem";

export interface ChainConfig {
    chainId: number;
    longPool: Address;
    shortPool: Address;
    wasabiRouter: Address;
    addressProvider: Address;
    weth: Address;
    swapRouter: Address;
    feeReceiver: Address;
    swapFeeReceiver: Address;
    perpManager: Address;
    exactOutSwapper: Address;
    partnerFeeManager: Address;
    liquidationFeeReceiver: Address;
    stakingAccountFactory?: Address;
}