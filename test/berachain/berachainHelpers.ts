import type { Address } from 'abitype'
import { Account, getAddress, parseEther, zeroAddress } from 'viem';
import { expect } from "chai";
import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { validatorPubKey } from "./berachainFixtures";

export async function distributeRewards(
    hre: HardhatRuntimeEnvironment, 
    distributorAddress: Address, 
    bgtAddress: Address,
    rewardVaultAddress: Address, 
    owner: Account,
    timestamp: number
) {
    const distributor = await hre.viem.getContractAt("BerachainDistributorMock", distributorAddress);
    const bgt = await hre.viem.getContractAt("BGT", bgtAddress);

    expect(await bgt.read.normalizedBoost([validatorPubKey])).to.equal(parseEther("1"));
    await distributor.write.distributeFor([BigInt(timestamp), validatorPubKey], { account: owner });
    const distributedEvents = await distributor.getEvents.Distributed();
    expect(distributedEvents).to.have.lengthOf(1, "Distributed event not emitted");
    const distributedEvent = distributedEvents[0].args;
    const rewardAmount = distributedEvent.amount!;
    expect (distributedEvent.receiver).to.equal(rewardVaultAddress);
    expect (rewardAmount).to.be.gt(0n);
    return rewardAmount;
}

export async function splitSharesWithFee(hre: HardhatRuntimeEnvironment, vaultAddress: Address, shares: bigint) {
    const vault = await hre.viem.getContractAt("BeraVault", vaultAddress);
    const rewardFeeBips = await vault.read.rewardFeeBips();
    const rewardFee = shares * rewardFeeBips / 10_000n;
    const sharesMinusFee = shares - rewardFee;
    return { sharesMinusFee, rewardFee };
}

export async function checkDepositEvents(hre: HardhatRuntimeEnvironment, vaultAddress: Address, userAddress: Address, expectedAssets: bigint) {
    const vault = await hre.viem.getContractAt("BeraVault", vaultAddress);
    const expectedShares = await vault.read.previewDeposit([expectedAssets]);
    const depositEvents = await vault.getEvents.Deposit();
    expect(depositEvents.length).to.equal(1);
    expect(depositEvents[0].args.sender).to.equal(getAddress(userAddress));
    expect(depositEvents[0].args.owner).to.equal(getAddress(userAddress));
    expect(depositEvents[0].args.assets).to.equal(expectedAssets);
    expect(depositEvents[0].args.shares).to.equal(expectedShares);

    await checkDepositTransferEvents(hre, vaultAddress, expectedShares);
    await checkStakedEvents(hre, vaultAddress, userAddress, expectedShares);
}

export async function checkDepositTransferEvents(hre: HardhatRuntimeEnvironment, vaultAddress: Address, expectedAmount: bigint) {
    const vault = await hre.viem.getContractAt("BeraVault", vaultAddress);
    const rewardFeeBips = await vault.read.rewardFeeBips();
    const rewardVaultAddress = await vault.read.rewardVault();
    const { sharesMinusFee, rewardFee } = await splitSharesWithFee(hre, vaultAddress, expectedAmount);

    const transferEvents = await vault.getEvents.Transfer();
    expect(transferEvents.length).to.equal(rewardFeeBips == 0n ? 2 : 3);
    expect(transferEvents[0].args.from).to.equal(zeroAddress);
    expect(transferEvents[0].args.to).to.equal(vaultAddress);
    expect(transferEvents[0].args.value).to.equal(expectedAmount);
    expect(transferEvents[1].args.from).to.equal(vaultAddress);
    expect(transferEvents[1].args.to).to.equal(rewardVaultAddress);
    expect(transferEvents[1].args.value).to.equal(sharesMinusFee);
    if (rewardFeeBips == 0n) {
        return;
    }
    expect(transferEvents[2].args.from).to.equal(vaultAddress);
    expect(transferEvents[2].args.to).to.equal(rewardVaultAddress);
    expect(transferEvents[2].args.value).to.equal(rewardFee);
}

export async function checkStakedEvents(hre: HardhatRuntimeEnvironment, vaultAddress: Address, userAddress: Address, expectedAmount: bigint) {
    const vault = await hre.viem.getContractAt("BeraVault", vaultAddress);
    const rewardVaultAddress = await vault.read.rewardVault();
    const rewardVault = await hre.viem.getContractAt("RewardVault", rewardVaultAddress);
    const { sharesMinusFee, rewardFee } = await splitSharesWithFee(hre, vaultAddress, expectedAmount);

    const delegateStakedEvents = await rewardVault.getEvents.DelegateStaked();
    expect(delegateStakedEvents.length).to.equal(1);
    expect(delegateStakedEvents[0].args.account).to.equal(getAddress(userAddress));
    expect(delegateStakedEvents[0].args.delegate).to.equal(vaultAddress);
    expect(delegateStakedEvents[0].args.amount).to.equal(sharesMinusFee);

    const stakedEvents = await rewardVault.getEvents.Staked();
    expect(stakedEvents.length).to.equal(rewardFee == 0n ? 1 : 2);
    expect(stakedEvents[0].args.account).to.equal(getAddress(userAddress));
    expect(stakedEvents[0].args.amount).to.equal(sharesMinusFee);
    if (rewardFee == 0n) {
        return
    }
    expect(stakedEvents[1].args.account).to.equal(vaultAddress);
    expect(stakedEvents[1].args.amount).to.equal(rewardFee);
}

export async function checkWithdrawEvents(hre: HardhatRuntimeEnvironment, vaultAddress: Address, userAddress: Address, expectedAssets: bigint, expectedShares: bigint) {
    const vault = await hre.viem.getContractAt("BeraVault", vaultAddress);
    const withdrawEvents = await vault.getEvents.Withdraw();
    expect(withdrawEvents.length).to.equal(1);
    expect(withdrawEvents[0].args.sender).to.equal(getAddress(userAddress));
    expect(withdrawEvents[0].args.receiver).to.equal(getAddress(userAddress));
    expect(withdrawEvents[0].args.owner).to.equal(getAddress(userAddress));
    expect(withdrawEvents[0].args.assets).to.equal(expectedAssets);
    expect(withdrawEvents[0].args.shares).to.equal(expectedShares);

    await checkWithdrawTransferEvents(hre, vaultAddress, expectedShares);
    await checkWithdrawnEvents(hre, vaultAddress, userAddress, expectedShares);
}

export async function checkWithdrawTransferEvents(hre: HardhatRuntimeEnvironment, vaultAddress: Address, expectedAmount: bigint) {
    const vault = await hre.viem.getContractAt("BeraVault", vaultAddress);
    const rewardFeeBips = await vault.read.rewardFeeBips();
    const rewardVaultAddress = await vault.read.rewardVault();

    const transferEvents = await vault.getEvents.Transfer();
    expect(transferEvents.length).to.equal(rewardFeeBips == 0n ? 2 : 3);
    expect(transferEvents[0].args.from).to.equal(rewardVaultAddress);
    expect(transferEvents[0].args.to).to.equal(vaultAddress);
    expect(transferEvents[rewardFeeBips == 0n ? 1 : 2].args.from).to.equal(vaultAddress);
    expect(transferEvents[rewardFeeBips == 0n ? 1 : 2].args.to).to.equal(zeroAddress);
    expect(transferEvents[rewardFeeBips == 0n ? 1 : 2].args.value).to.equal(expectedAmount);
    if (rewardFeeBips != 0n) {
        expect(transferEvents[1].args.from).to.equal(rewardVaultAddress);
        expect(transferEvents[1].args.to).to.equal(vaultAddress);
        expect(transferEvents[0].args.value! + transferEvents[1].args.value!).to.equal(expectedAmount);
    } else {
        expect(transferEvents[0].args.value).to.equal(expectedAmount);
    }
}

export async function checkWithdrawnEvents(hre: HardhatRuntimeEnvironment, vaultAddress: Address, userAddress: Address, expectedAmount: bigint) {
    const vault = await hre.viem.getContractAt("BeraVault", vaultAddress);
    const rewardVaultAddress = await vault.read.rewardVault();
    const rewardVault = await hre.viem.getContractAt("RewardVault", rewardVaultAddress);
    const { sharesMinusFee, rewardFee } = await splitSharesWithFee(hre, vaultAddress, expectedAmount);

    const delegateWithdrawnEvents = await rewardVault.getEvents.DelegateWithdrawn();
    expect(delegateWithdrawnEvents.length).to.equal(1);
    expect(delegateWithdrawnEvents[0].args.account).to.equal(getAddress(userAddress));
    expect(delegateWithdrawnEvents[0].args.delegate).to.equal(vaultAddress);
    expect(delegateWithdrawnEvents[0].args.amount).to.be.approximately(sharesMinusFee, 1n);

    const withdrawnEvents = await rewardVault.getEvents.Withdrawn();
    expect(withdrawnEvents.length).to.equal(rewardFee == 0n ? 1 : 2);
    expect(withdrawnEvents[0].args.account).to.equal(getAddress(userAddress));
    expect(withdrawnEvents[0].args.amount).to.be.approximately(sharesMinusFee, 1n);
    if (rewardFee == 0n) {
        return
    }
    expect(withdrawnEvents[1].args.account).to.equal(vault.address);
    expect(withdrawnEvents[1].args.amount).to.be.approximately(rewardFee, 1n);
    expect(withdrawnEvents[0].args.amount! + withdrawnEvents[1].args.amount!).to.equal(expectedAmount);
}

export async function checkMigrateTransferEvents(hre: HardhatRuntimeEnvironment, vaultAddress: Address, totalShares: bigint) {
    // Assumes only one address is migrated
    const vault = await hre.viem.getContractAt("BeraVault", vaultAddress);
    const rewardVaultAddress = await vault.read.rewardVault();
    const { rewardFee } = await splitSharesWithFee(hre, vaultAddress, totalShares);

    const transferEvents = await vault.getEvents.Transfer();
    expect(transferEvents.length).to.equal(2);
    expect(transferEvents[0].args.from).to.equal(rewardVaultAddress);
    expect(transferEvents[0].args.to).to.equal(vaultAddress);
    expect(transferEvents[0].args.value).to.equal(rewardFee);
    expect(transferEvents[1].args.from).to.equal(vaultAddress);
    expect(transferEvents[1].args.to).to.equal(rewardVaultAddress);
    expect(transferEvents[1].args.value).to.equal(rewardFee);
}