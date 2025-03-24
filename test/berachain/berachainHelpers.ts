import type { Address } from 'abitype'
import hre from "hardhat";

export async function splitSharesWithFee(vaultAddress: Address, shares: bigint) {
    const vault = await hre.viem.getContractAt("BeraVault", vaultAddress);
    const rewardFeeBips = await vault.read.rewardFeeBips();
    const rewardFee = shares * rewardFeeBips / 10_000n;
    const sharesMinusFee = shares - rewardFee;
    return { sharesMinusFee, rewardFee };
}