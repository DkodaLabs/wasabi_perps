import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import hre from "hardhat";
import { parseEther, zeroAddress} from "viem";
import { FunctionCallData, OpenPositionRequest, getValueWithoutFee } from "./utils/PerpStructUtils";
import { signOpenPositionRequest } from "./utils/SigningUtils";
import { getApproveAndSwapFunctionCallData } from "./utils/SwapUtils";

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
export async function deployDebtController() {
    const maxApy = 300n; // 300% APY
    const maxLeverage = 500n; // 5x Leverage

    // Contracts are deployed using the first signer/account by default
    const [owner, otherAccount] = await hre.viem.getWalletClients();
    const debtController = await hre.viem.deployContract("DebtController", [maxApy, maxLeverage]);
    const publicClient = await hre.viem.getPublicClient();

    return {
        debtController,
        maxApy,
        maxLeverage,
        owner,
        otherAccount,
        publicClient,
    };
}

export async function deployLongPoolMockEnvironment() {
    const wasabiLongPool = await deployWasabiLongPool();
    const [owner] = await hre.viem.getWalletClients();

    const initialPrice = 10_000n;
    const mockSwap = await hre.viem.deployContract("MockSwap", [], { value: parseEther("50") });
    const uPPG = await hre.viem.deployContract("MockERC20", ["μPudgyPenguins", 'μPPG']);
    await uPPG.write.mint([mockSwap.address, parseEther("50")]);
    await mockSwap.write.setPrice([uPPG.address, zeroAddress, initialPrice]);

    const downPayment = parseEther("1");
    const principal = getValueWithoutFee(parseEther("3"), wasabiLongPool.tradeFeeValue);
    const amount = getValueWithoutFee(downPayment, wasabiLongPool.tradeFeeValue) + principal;

    const functionCallDataList: FunctionCallData[] =
        getApproveAndSwapFunctionCallData(mockSwap.address, zeroAddress, uPPG.address, amount);
    
    const openPositionRequest: OpenPositionRequest = {
        id: 1n,
        currency: zeroAddress,
        targetCurrency: uPPG.address,
        downPayment: parseEther("1"),
        principal: getValueWithoutFee(parseEther("3"), wasabiLongPool.tradeFeeValue),
        minTargetAmount: parseEther("3"),
        expiration: BigInt(await time.latest()) + 86400n,
        swapPrice: 0n,
        swapPriceDenominator: 0n,
        functionCallDataList 
    };
    const signature = await signOpenPositionRequest(
        owner, wasabiLongPool.contractName, wasabiLongPool.wasabiLongPool.address, openPositionRequest);

    return {
        ...wasabiLongPool,
        mockSwap,
        uPPG,
        openPositionRequest,
        downPayment,
        signature,
        initialPrice
    }
}

export async function deployWasabiLongPool() {
    const feeControllerFixture = await deployFeeController();
    const debtControllerFixture = await deployDebtController();

    // Setup
    const [owner, user1] = await hre.viem.getWalletClients();
    owner.signTypedData
    const publicClient = await hre.viem.getPublicClient();

    // Deploy WasabiLongPool
    const contractName = "WasabiLongPool";
    const wasabiLongPool = 
        await hre.viem.deployContract(
            contractName,
            [debtControllerFixture.debtController.address, feeControllerFixture.feeController.address],
            { value: parseEther("10") });

    return {
        ...feeControllerFixture,
        ...debtControllerFixture,
        wasabiLongPool,
        owner,
        user1,
        publicClient,
        contractName,
    };
}