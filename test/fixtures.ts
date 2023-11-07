import hre from "hardhat";

export async function deployFeeController() {
    const tradeFeeValue = 50n; // 0.5%
    const swapFeeValue = 30n; // 0.3%

    // Contracts are deployed using the first signer/account by default
    const [owner] = await hre.viem.getWalletClients();
    const feeController = await hre.viem.deployContract("FeeController", [owner.account.address, tradeFeeValue, swapFeeValue]);
    const publicClient = await hre.viem.getPublicClient();

    return {
        feeReceiver: owner.account.address,
        feeController,
        tradeFeeValue,
        swapFeeValue,
        owner,
        publicClient,
        feeDenominator: 10_000n,
    };
}