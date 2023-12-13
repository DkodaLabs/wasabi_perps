import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import type { Address } from 'abitype'
import hre from "hardhat";
import { parseEther, zeroAddress, getAddress, maxUint256, encodeFunctionData } from "viem";
import { ClosePositionRequest, FunctionCallData, OpenPositionRequest, Position, Vault, WithSignature, getEventPosition, getFee, getValueWithoutFee } from "./utils/PerpStructUtils";
import { signClosePositionRequest, signOpenPositionRequest } from "./utils/SigningUtils";
import { getApproveAndSwapExactlyOutFunctionCallData, getApproveAndSwapFunctionCallData, getERC20ApproveFunctionCallData } from "./utils/SwapUtils";
import { WETHAbi } from "./utils/WETHAbi";

export type CreateClosePositionRequestParams = {
    position: Position,
    interest?: bigint,
    expiration?: number
}

export async function deployWeth() {
    const weth = await hre.viem.deployContract("WETH9");
    await weth.write.deposit([], { value: parseEther("10") });
    return { weth, wethAddress: weth.address };
}

export async function deployMaliciousVault(poolAddress: Address, addressProvider: Address, tokenAddress: Address, name: string, symbol: string) {
    const contractName = "MaliciousVault";
    const WasabiVault = await hre.ethers.getContractFactory(contractName);
    const address = 
        await hre.upgrades.deployProxy(
            WasabiVault,
            [poolAddress, addressProvider, tokenAddress, name, symbol],
            { kind: 'uups'}
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const vault = await hre.viem.getContractAt(contractName, address);
    return { vault }
}

export async function deployVault(poolAddress: Address, addressProvider: Address, tokenAddress: Address, name: string, symbol: string) {
    const contractName = "WasabiVault";
    const WasabiVault = await hre.ethers.getContractFactory(contractName);
    const address = 
        await hre.upgrades.deployProxy(
            WasabiVault,
            [poolAddress, addressProvider, tokenAddress, name, symbol],
            { kind: 'uups'}
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const vault = await hre.viem.getContractAt(contractName, address);
    return { vault }
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
    const {tradeFeeValue, contractName, wasabiLongPool, user1, user2, publicClient, feeDenominator, debtController, wethAddress, weth} = wasabiLongPoolFixture;
    const [owner] = await hre.viem.getWalletClients();

    const initialPrice = 10_000n;
    const priceDenominator = 10_000n;
    const leverage = 4n;

    const mockSwap = await hre.viem.deployContract("MockSwap", []);
    await weth.write.deposit([], { value: parseEther("50") });
    await weth.write.transfer([mockSwap.address, parseEther("50")]);

    const uPPG = await hre.viem.deployContract("MockERC20", ["μPudgyPenguins", 'μPPG']);
    await uPPG.write.mint([mockSwap.address, parseEther("50")]);
    await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice]);

    const totalAmountIn = parseEther("1");
    const fee = getFee(totalAmountIn * leverage, tradeFeeValue);
    const downPayment = totalAmountIn - fee;
    const principal = downPayment * (leverage - 1n);
    const totalSize = principal + downPayment;

    const functionCallDataList: FunctionCallData[] =
        getApproveAndSwapFunctionCallData(mockSwap.address, wethAddress, uPPG.address, totalSize);

    await weth.write.deposit([], { value: parseEther("50"), account: user1.account });
    await weth.write.approve([wasabiLongPool.address, maxUint256], {account: user1.account});
    await weth.write.deposit([], { value: parseEther("50"), account: user2.account });
    await weth.write.approve([wasabiLongPool.address, maxUint256], {account: user2.account});

    const openPositionRequest: OpenPositionRequest = {
        id: 1n,
        currency: wethAddress,
        targetCurrency: uPPG.address,
        downPayment,
        principal,
        minTargetAmount: totalSize * initialPrice / priceDenominator,
        expiration: BigInt(await time.latest()) + 86400n,
        fee,
        functionCallDataList 
    };
    const signature = await signOpenPositionRequest(owner, contractName, wasabiLongPool.address, openPositionRequest);

    const sendDefaultOpenPositionRequest = async () => {
        const hash = await wasabiLongPool.write.openPosition([openPositionRequest, signature], { account: user1.account });
        const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
        const event = (await wasabiLongPool.getEvents.PositionOpened())[0];
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

    const computeMaxInterest = async (position: Position): Promise<bigint> => {
        return await debtController.read.computeMaxInterest([position.collateralCurrency, position.principal, position.lastFundingTimestamp], { blockTag: 'pending' });
    }

    const computeLiquidationPrice = async (position: Position): Promise<bigint> => {
        const threshold = 500n; // 5 percent

        const currentInterest = await computeMaxInterest(position);
        const payoutLiquidationThreshold = position.principal * (threshold + tradeFeeValue) / (feeDenominator - tradeFeeValue);

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
        computeLiquidationPrice,
        computeMaxInterest,
        totalAmountIn
    }
}

export async function deployAddressProvider() {
    const wethFixture = await deployWeth();
    const feeControllerFixture = await deployFeeController();
    const debtControllerFixture = await deployDebtController();
    const [owner, user1] = await hre.viem.getWalletClients();
    const addressProvider = 
        await hre.viem.deployContract(
            "AddressProvider",
            [debtControllerFixture.debtController.address, feeControllerFixture.feeController.address, wethFixture.wethAddress]);
    return {
        ...wethFixture,
        ...feeControllerFixture,
        ...debtControllerFixture,
        addressProvider,
        owner,
        user1
    };
}

export async function deployAddressProvider2() {
    const feeControllerFixture = await deployFeeController();
    const debtControllerFixture = await deployDebtController();
    const [owner, user1] = await hre.viem.getWalletClients();
    const addressProvider = 
        await hre.viem.deployContract(
            "MockAddressProviderV2",
            [debtControllerFixture.debtController.address, feeControllerFixture.feeController.address]);
    return {
        ...feeControllerFixture,
        ...debtControllerFixture,
        addressProvider,
        owner,
        user1
    };
}

export async function deployWasabiLongPool() {
    const addressProviderFixture = await deployAddressProvider();
    const {addressProvider, weth} = addressProviderFixture;

    // Setup
    const [owner, user1, user2] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    // Deploy WasabiLongPool
    const contractName = "WasabiLongPool";
    const WasabiLongPool = await hre.ethers.getContractFactory(contractName);
    const address = 
        await hre.upgrades.deployProxy(
            WasabiLongPool,
            [addressProviderFixture.addressProvider.address],
            { kind: 'uups'}
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const wasabiLongPool = await hre.viem.getContractAt(contractName, address);

    const vaultFixture = await deployVault(
        wasabiLongPool.address, addressProvider.address, weth.address, "WETH Vault", "wasabWETH");
    const vault = vaultFixture.vault;
    await wasabiLongPool.write.addVault([vault.address]);
    await vault.write.depositEth([owner.account.address], { value: parseEther("20") });

    const maliciousVault = await deployMaliciousVault(wasabiLongPool.address, addressProvider.address, weth.address, "WETH Vault", "wasabWETH");

    return {
        ...vaultFixture,
        ...addressProviderFixture,
        maliciousVault,
        wasabiLongPool,
        owner,
        user1,
        user2,
        publicClient,
        contractName,
    };
}

export async function deployWasabiShortPool() {
    const addressProviderFixture = await deployAddressProvider();
    const {addressProvider} = addressProviderFixture;

    // Setup
    const [owner, user1, user2] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    // Deploy WasabiLongPool
    const contractName = "WasabiShortPool";
    const WasabiShortPool = await hre.ethers.getContractFactory(contractName);
    const proxy = await hre.upgrades.deployProxy(
        WasabiShortPool,
        [addressProviderFixture.addressProvider.address],
        { kind: 'uups'}
    );
    await proxy.waitForDeployment();
    
    const address = getAddress(await proxy.getAddress());

    const wasabiShortPool = await hre.viem.getContractAt(contractName, address);

    const uPPG = await hre.viem.deployContract("MockERC20", ["μPudgyPenguins", 'μPPG']);

    const vaultFixture = await deployVault(
        wasabiShortPool.address, addressProvider.address, uPPG.address, "PPG Vault", "wuPPG");
    const {vault} = vaultFixture;

    const amount = parseEther("10");
    await uPPG.write.mint([amount]);
    await uPPG.write.approve([vault.address, amount]);
    await vault.write.deposit([amount, owner.account.address]);
    await wasabiShortPool.write.addVault([vault.address]);

    return {
        ...addressProviderFixture,
        wasabiShortPool,
        owner,
        user1,
        user2,
        publicClient,
        contractName,
        uPPG
    };
}


export async function deployShortPoolMockEnvironment() {
    const wasabiShortPoolFixture = await deployWasabiShortPool();
    const {tradeFeeValue, contractName, wasabiShortPool, user1, publicClient, feeDenominator, debtController, uPPG, wethAddress, weth} = wasabiShortPoolFixture;
    const [owner] = await hre.viem.getWalletClients();

    const initialPrice = 10_000n;
    const priceDenominator = 10_000n;

    const mockSwap = await hre.viem.deployContract("MockSwap", []);
    await weth.write.deposit([], { value: parseEther("50") });
    await weth.write.transfer([mockSwap.address, parseEther("50")]);

    await uPPG.write.mint([mockSwap.address, parseEther("50")]);
    await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPrice]);

    // Deploy some tokens to the short pool for collateral

    const leverage = 2n;
    const totalAmountIn = parseEther("1");
    const fee = getFee(totalAmountIn * (leverage + 1n), tradeFeeValue);
    const downPayment = totalAmountIn - fee;

    const swappedAmount = downPayment * initialPrice / priceDenominator;
    const principal = swappedAmount * leverage;

    const functionCallDataList: FunctionCallData[] =
        getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principal);

    await weth.write.deposit([], { value: parseEther("50"), account: user1.account });
    await weth.write.approve([wasabiShortPool.address, maxUint256], {account: user1.account});

    const openPositionRequest: OpenPositionRequest = {
        id: 1n,
        currency: uPPG.address,
        targetCurrency: wethAddress,
        downPayment,
        principal,
        minTargetAmount: principal * initialPrice / priceDenominator,
        expiration: BigInt(await time.latest()) + 86400n,
        fee,
        functionCallDataList 
    };
    const signature = await signOpenPositionRequest(owner, contractName, wasabiShortPool.address, openPositionRequest);

    const sendDefaultOpenPositionRequest = async () => {
        const hash = await wasabiShortPool.write.openPosition([openPositionRequest, signature], { account: user1.account });
        const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed * r.effectiveGasPrice);
        const event = (await wasabiShortPool.getEvents.PositionOpened())[0];
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
        const amountOut = position.principal + (interest || 0n);

        let functionCallDataList: FunctionCallData[] = [];

        const wethBalance = await weth.read.balanceOf([wasabiShortPool.address]);
        if (wethBalance < amountOut) {
            const data = encodeFunctionData({
                abi: [WETHAbi.find(a => a.type === "function" && a.name === "deposit")!],
                functionName: "deposit"
            });
        
            const functionCallData: FunctionCallData = {
                to: wethAddress,
                value: amountOut - wethBalance,
                data
            }
            functionCallDataList.push(functionCallData);
        }

        functionCallDataList = [
            ...functionCallDataList,
            ...getApproveAndSwapExactlyOutFunctionCallData(
                mockSwap.address,
                position.collateralCurrency,
                position.currency,
                position.collateralAmount,
                amountOut
            )
        ]

        const request: ClosePositionRequest = {
            expiration: expiration ? BigInt(expiration) : (BigInt(await time.latest()) + 300n),
            interest: interest || 0n,
            position,
            functionCallDataList,
        };
        return request;
    }

    const createClosePositionOrder = async (params: CreateClosePositionRequestParams): Promise<WithSignature<ClosePositionRequest>> => {
        const request = await createClosePositionRequest(params);
        const signature = await signClosePositionRequest(owner, contractName, wasabiShortPool.address, request);
        return { request, signature }
    }

    const computeMaxInterest = async (position: Position): Promise<bigint> => {
        return await debtController.read.computeMaxInterest([position.currency, position.principal, position.lastFundingTimestamp], { blockTag: 'pending' });
    }

    const computeLiquidationPrice = async (position: Position): Promise<bigint> => {
        const threshold = 500n; // 5 percent

        const currentInterest = await computeMaxInterest(position);
        const payoutLiquidationThreshold = position.collateralAmount * (threshold + tradeFeeValue) / (feeDenominator - tradeFeeValue);

        const liquidationAmount = position.collateralAmount - payoutLiquidationThreshold;
        return liquidationAmount * priceDenominator / (position.principal + currentInterest);
    }

    const getBalance = async (currency: string, address: string) => {
        if (currency === zeroAddress) {
            return await publicClient.getBalance({address: getAddress(address)});
        } else if (getAddress(currency) === getAddress(uPPG.address)) {
            return await uPPG.read.balanceOf([getAddress(address)]);
        } else {
            throw new Error(`Unknown currency ${currency}`);
        }
    }

    return {
        ...wasabiShortPoolFixture,
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
        computeLiquidationPrice,
        computeMaxInterest,
        getBalance
    }
}