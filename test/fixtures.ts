import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import hre from "hardhat";
import { parseEther, zeroAddress} from "viem";
import { ClosePositionRequest, FunctionCallData, OpenPositionRequest, Position, WithSignature, getEventPosition, getValueWithoutFee } from "./utils/PerpStructUtils";
import { signClosePositionRequest, signOpenPositionRequest } from "./utils/SigningUtils";
import { getApproveAndSwapFunctionCallData } from "./utils/SwapUtils";

export type CreateClosePositionRequestParams = {
    position: Position,
    interest?: bigint,
    expiration?: number
}

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
    const wasabiLongPoolFixture = await deployWasabiLongPool();
    const {tradeFeeValue, contractName, wasabiLongPool, user1, publicClient, feeDenominator, debtController} = wasabiLongPoolFixture;
    const [owner] = await hre.viem.getWalletClients();

    const initialPrice = 10_000n;
    const priceDenominator = 10_000n;

    const mockSwap = await hre.viem.deployContract("MockSwap", [], { value: parseEther("50") });
    const uPPG = await hre.viem.deployContract("MockERC20", ["μPudgyPenguins", 'μPPG']);
    await uPPG.write.mint([mockSwap.address, parseEther("50")]);
    await mockSwap.write.setPrice([uPPG.address, zeroAddress, initialPrice]);

    const downPayment = parseEther("1");
    const principal = getValueWithoutFee(downPayment, tradeFeeValue) * 3n;
    const amount = getValueWithoutFee(downPayment, tradeFeeValue) + principal;

    const functionCallDataList: FunctionCallData[] =
        getApproveAndSwapFunctionCallData(mockSwap.address, zeroAddress, uPPG.address, amount);
    
    const openPositionRequest: OpenPositionRequest = {
        id: 1n,
        currency: zeroAddress,
        targetCurrency: uPPG.address,
        downPayment,
        principal,
        minTargetAmount: amount * initialPrice / priceDenominator,
        expiration: BigInt(await time.latest()) + 86400n,
        swapPrice: 0n,
        swapPriceDenominator: 0n,
        functionCallDataList 
    };
    const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, openPositionRequest);

    const sendDefaultOpenPositionRequest = async () => {
        const hash = await wasabiLongPool.write.openPosition([openPositionRequest, signature], { value: downPayment, account: user1.account });
        const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
        const event = (await wasabiLongPool.getEvents.OpenPosition())[0];
        const position: Position = await getEventPosition(event);

        return {
            position,
            hash,
            gasUsed,
            event
        }
    }

    const createClosePositionRequest = async (params: CreateClosePositionRequestParams): Promise<ClosePositionRequest> => {
        const { position, interest, expiration } = params;
        const request: ClosePositionRequest = {
            expiration: expiration ? BigInt(expiration) : (BigInt(await time.latest()) + 300n),
            interest: interest || 0n,
            position,
            functionCallDataList: getApproveAndSwapFunctionCallData(mockSwap.address, position.collateralCurrency, position.currency, position.collateralAmount),
        };
        return request;
    }

    const createClosePositionOrder = async (params: CreateClosePositionRequestParams): Promise<WithSignature<ClosePositionRequest>> => {
        const request = await createClosePositionRequest(params);
        const signature = await signClosePositionRequest(owner, contractName, wasabiLongPool.address, request);
        return { request, signature }
    }

    const computeLiquidationPrice = async (position: Position): Promise<bigint> => {
        const currentInterest = await debtController.read.computeMaxInterest([position.collateralCurrency, position.principal, position.lastFundingTimestamp]);
        const liquidationThreshold = position.principal * 5n / 100n;
        const payoutLiquidationThreshold = liquidationThreshold * feeDenominator / (feeDenominator - tradeFeeValue);
        const liquidationAmount = payoutLiquidationThreshold + position.principal + currentInterest;
        return liquidationAmount * priceDenominator / position.collateralAmount;
    }

    return {
        ...wasabiLongPoolFixture,
        mockSwap,
        uPPG,
        openPositionRequest,
        downPayment,
        signature,
        initialPrice,
        priceDenominator,
        sendDefaultOpenPositionRequest,
        createClosePositionRequest,
        createClosePositionOrder,
        computeLiquidationPrice
    }
}

export async function deployWasabiLongPool() {
    const feeControllerFixture = await deployFeeController();
    const debtControllerFixture = await deployDebtController();

    // Setup
    const [owner, user1, user2] = await hre.viem.getWalletClients();
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
        user2,
        publicClient,
        contractName,
    };
}