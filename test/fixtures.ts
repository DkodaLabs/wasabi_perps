import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import type { Address } from 'abitype'
import hre from "hardhat";
import { parseEther, zeroAddress, getAddress, maxUint256, encodeFunctionData, parseUnits } from "viem";
import { ClosePositionRequest, ClosePositionOrder, OrderType, FunctionCallData, OpenPositionRequest, Position, Vault, WithSignature, getEventPosition, getFee, getValueWithoutFee } from "./utils/PerpStructUtils";
import { Signer, signClosePositionRequest, signClosePositionOrder, signOpenPositionRequest } from "./utils/SigningUtils";
import { getApproveAndSwapExactlyOutFunctionCallData, getApproveAndSwapFunctionCallData, getERC20ApproveFunctionCallData } from "./utils/SwapUtils";
import { WETHAbi } from "./utils/WETHAbi";
import { LIQUIDATOR_ROLE, ORDER_SIGNER_ROLE, ORDER_EXECUTOR_ROLE } from "./utils/constants";

const tradeFeeValue = 50n; // 0.5%
const feeDenominator = 10000n;

export type CreateClosePositionRequestParams = {
    position: Position,
    interest?: bigint,
    expiration?: number
}

export type CreateClosePositionOrderParams = {
    orderType: OrderType,
    traderSigner: Signer,
    positionId: bigint,
    makerAmount: bigint,
    takerAmount: bigint,
    createdAt?: number,
    expiration?: number
    executionFee?: bigint
}

export async function deployPerpManager() {
    // Contracts are deployed using the first signer/account by default
    const [owner, user1, user2, liquidator, orderSigner, orderExecutor] = await hre.viem.getWalletClients();

    const contractName = "PerpManager";
    const PerpManager = await hre.ethers.getContractFactory(contractName);
    const address = 
        await hre.upgrades.deployProxy(
            PerpManager,
            [],
            { kind: 'uups'}
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const manager = await hre.viem.getContractAt(contractName, address);
    await manager.write.grantRole([LIQUIDATOR_ROLE, liquidator.account.address, 0]);
    await manager.write.grantRole([ORDER_SIGNER_ROLE, orderSigner.account.address, 0]);
    await manager.write.grantRole([ORDER_EXECUTOR_ROLE, orderExecutor.account.address, 0]);
    return { manager, liquidator, orderSigner, user1, owner, orderExecutor}
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
    const {tradeFeeValue, contractName, wasabiLongPool, user1, user2, publicClient, feeDenominator, debtController, wethAddress, weth, orderSigner} = wasabiLongPoolFixture;
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
    const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, openPositionRequest);

    const sendDefaultOpenPositionRequest = async (id?: bigint | undefined) => {
        const request = id ? {...openPositionRequest, id} : openPositionRequest;
        const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiLongPool.address, request);
        const hash = await wasabiLongPool.write.openPosition([request, signature], { account: user1.account });
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

    const createSignedClosePositionRequest = async (params: CreateClosePositionRequestParams): Promise<WithSignature<ClosePositionRequest>> => {
        const request = await createClosePositionRequest(params);
        const signature = await signClosePositionRequest(orderSigner, contractName, wasabiLongPool.address, request);
        return { request, signature }
    }

    const createClosePositionOrder = async (params: CreateClosePositionOrderParams): Promise<ClosePositionOrder> => {
        const { orderType, positionId, makerAmount, takerAmount, createdAt, expiration, executionFee } = params;
        const order: ClosePositionOrder = {
            orderType,
            positionId,
            makerAmount,
            takerAmount,
            createdAt: createdAt ? BigInt(createdAt) : BigInt(await time.latest()),
            expiration: expiration ? BigInt(expiration) : (BigInt(await time.latest()) + 300n),
            executionFee: executionFee || 0n
        }
        return order;
    }

    const createSignedClosePositionOrder = async (params: CreateClosePositionOrderParams): Promise<WithSignature<ClosePositionOrder>> => {
        const {traderSigner} = params;
        const order = await createClosePositionOrder(params);
        const signature = await signClosePositionOrder(traderSigner, contractName, wasabiLongPool.address, order);
        return { request: order, signature }
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
        createSignedClosePositionRequest,
        createClosePositionOrder,
        createSignedClosePositionOrder,
        computeLiquidationPrice,
        computeMaxInterest,
        totalAmountIn
    }
}

export async function deployAddressProvider() {
    const wethFixture = await deployWeth();
    const debtControllerFixture = await deployDebtController();
    const [owner, user1, user2, user3, user4] = await hre.viem.getWalletClients();
    const addressProvider = 
        await hre.viem.deployContract(
            "AddressProvider",
            [debtControllerFixture.debtController.address, zeroAddress, owner.account.address, wethFixture.wethAddress, user4.account.address]);
    return {
        ...wethFixture,
        ...debtControllerFixture,
        addressProvider,
        owner,
        user1,
        tradeFeeValue,
        feeDenominator,
        feeReceiver: owner.account.address,
        liquidationFeeReceiver: user4.account.address
    };
}

export async function deployAddressProvider2() {
    const debtControllerFixture = await deployDebtController();
    const [owner, user1] = await hre.viem.getWalletClients();
    const addressProvider = 
        await hre.viem.deployContract(
            "MockAddressProviderV2",
            [debtControllerFixture.debtController.address, zeroAddress, owner.account.address, zeroAddress]);
    return {
        ...debtControllerFixture,
        addressProvider,
        owner,
        user1
    };
}

export async function deployWasabiLongPool() {
    const perpManager = await deployPerpManager();

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
            [addressProviderFixture.addressProvider.address, perpManager.manager.address],
            { kind: 'uups'}
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const wasabiLongPool = await hre.viem.getContractAt(contractName, address);

    const implAddress = await hre.upgrades.erc1967.getImplementationAddress(address);

    const vaultFixture = await deployVault(
        wasabiLongPool.address, addressProvider.address, weth.address, "WETH Vault", "wasabWETH");
    const vault = vaultFixture.vault;
    await wasabiLongPool.write.addVault([vault.address]);
    await vault.write.depositEth([owner.account.address], { value: parseEther("20") });

    const maliciousVault = await deployMaliciousVault(wasabiLongPool.address, addressProvider.address, weth.address, "WETH Vault", "wasabWETH");

    return {
        ...vaultFixture,
        ...addressProviderFixture,
        ...perpManager,
        maliciousVault,
        wasabiLongPool,
        owner,
        user1,
        user2,
        publicClient,
        contractName,
        implAddress
    };
}

export async function deployWasabiShortPool() {
    const perpManager = await deployPerpManager();
    const addressProviderFixture = await deployAddressProvider();
    const {addressProvider, weth} = addressProviderFixture;

    // Setup
    const [owner, user1, user2] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    // Deploy WasabiShortPool
    const contractName = "WasabiShortPool";
    const WasabiShortPool = await hre.ethers.getContractFactory(contractName);
    const proxy = await hre.upgrades.deployProxy(
        WasabiShortPool,
        [addressProviderFixture.addressProvider.address, perpManager.manager.address],
        { kind: 'uups'}
    );
    await proxy.waitForDeployment();
    
    const address = getAddress(await proxy.getAddress());

    const wasabiShortPool = await hre.viem.getContractAt(contractName, address);

    // Deploy WasabiLongPool (for USDC deposits on close)
    const WasabiLongPool = await hre.ethers.getContractFactory("WasabiLongPool");
    const longPoolAddress = 
        await hre.upgrades.deployProxy(
            WasabiLongPool,
            [addressProviderFixture.addressProvider.address, perpManager.manager.address],
            { kind: 'uups'}
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const wasabiLongPool = await hre.viem.getContractAt("WasabiLongPool", longPoolAddress);

    const uPPG = await hre.viem.deployContract("MockERC20", ["μPudgyPenguins", 'μPPG']);
    const usdc = await hre.viem.deployContract("USDC", []);

    const vaultFixture = await deployVault(
        wasabiShortPool.address, addressProvider.address, uPPG.address, "PPG Vault", "wuPPG");
    const {vault} = vaultFixture;

    // Deploy WETH & USDC Vaults
    const usdcVaultFixture = await deployVault(
        wasabiLongPool.address, addressProvider.address, usdc.address, "USDC Vault", "wUSDC");
    const usdcVault = usdcVaultFixture.vault;
    const wethVaultFixture = await deployVault(
        wasabiLongPool.address, addressProvider.address, weth.address, "WETH Vault", "wWETH");
    const wethVault = wethVaultFixture.vault;

    const amount = parseEther("50");
    await uPPG.write.mint([amount]);
    await uPPG.write.approve([vault.address, amount]);
    await vault.write.deposit([amount, owner.account.address]);
    await wasabiShortPool.write.addVault([vault.address]);
    await wasabiLongPool.write.addVault([wethVault.address]);
    await wasabiLongPool.write.addVault([usdcVault.address]);
    await addressProvider.write.addVault([vault.address]);
    await addressProvider.write.addVault([wethVault.address]);
    await addressProvider.write.addVault([usdcVault.address]);

    return {
        ...addressProviderFixture,
        ...perpManager,
        wasabiShortPool,
        wasabiLongPool,
        owner,
        user1,
        user2,
        publicClient,
        contractName,
        uPPG,
        usdc,
        usdcVault,
        wethVault,
    };
}


export async function deployShortPoolMockEnvironment() {
    const wasabiShortPoolFixture = await deployWasabiShortPool();
    const {tradeFeeValue, contractName, wasabiShortPool, orderSigner, user1, publicClient, feeDenominator, debtController, uPPG, wethAddress, weth, usdc} = wasabiShortPoolFixture;
    const [owner] = await hre.viem.getWalletClients();

    const initialPPGPrice = 10_000n;    // 1 PPG = 1 WETH
    const initialUSDCPrice = 4n;        // 1 USDC = 4/10000 WETH = 1/2500 WETH
    const priceDenominator = 10_000n;

    const mockSwap = await hre.viem.deployContract("MockSwap", []);
    await weth.write.deposit([], { value: parseEther("50") });
    await weth.write.transfer([mockSwap.address, parseEther("50")]);

    await uPPG.write.mint([mockSwap.address, parseEther("10")]);
    await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice]);

    await usdc.write.mint([mockSwap.address, parseUnits("10000", 6)]);
    await mockSwap.write.setPrice([usdc.address, wethAddress, initialUSDCPrice]);
    await mockSwap.write.setPrice([usdc.address, uPPG.address, initialUSDCPrice]);

    // Deploy some tokens to the short pool for collateral

    const leverage = 5n;
    const totalAmountIn = parseEther("1");
    const fee = getFee(totalAmountIn * (leverage + 1n), tradeFeeValue);
    const downPayment = totalAmountIn - fee;

    const swappedAmount = downPayment * initialPPGPrice / priceDenominator;
    const principal = swappedAmount * leverage;

    const functionCallDataList: FunctionCallData[] =
        getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, principal);

    await weth.write.deposit([], { value: parseEther("50"), account: user1.account });
    await weth.write.approve([wasabiShortPool.address, maxUint256], {account: user1.account});
    await usdc.write.mint([user1.account.address, parseUnits("10000", 6)]);
    await usdc.write.approve([wasabiShortPool.address, maxUint256], {account: user1.account});

    const openPositionRequest: OpenPositionRequest = {
        id: 1n,
        currency: uPPG.address,
        targetCurrency: wethAddress,
        downPayment,
        principal,
        minTargetAmount: principal * initialPPGPrice / priceDenominator,
        expiration: BigInt(await time.latest()) + 86400n,
        fee,
        functionCallDataList 
    };
    const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, openPositionRequest);

    const sendDefaultOpenPositionRequest = async (id?: bigint | undefined) => {
        const request = id ? {...openPositionRequest, id} : openPositionRequest;
        const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, request);
        const hash = await wasabiShortPool.write.openPosition([request, signature], { account: user1.account });
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

    const sendUSDCOpenPositionRequest = async (id?: bigint | undefined) => {
        const leverage = 5n;
        const totalAmountIn = parseUnits("500", 6);
        const fee = getFee(totalAmountIn * (leverage + 1n), tradeFeeValue);
        const downPayment = totalAmountIn - fee;
        const swappedAmount = downPayment * (10n ** (18n - 6n)) * initialUSDCPrice / priceDenominator;
        const principal = swappedAmount * leverage;
        const minTargetAmount = principal * initialPPGPrice / initialUSDCPrice / (10n ** (18n - 6n));

        const functionCallDataList: FunctionCallData[] = 
            getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, usdc.address, principal);
        const openPositionRequest: OpenPositionRequest = {
            id: id ?? 1n,
            currency: uPPG.address,
            targetCurrency: usdc.address,
            downPayment,
            principal,
            minTargetAmount,
            expiration: BigInt(await time.latest()) + 86400n,
            fee,
            functionCallDataList 
        };
        const signature = await signOpenPositionRequest(orderSigner, contractName, wasabiShortPool.address, openPositionRequest);

        const hash = await wasabiShortPool.write.openPosition([openPositionRequest, signature], { account: user1.account });

        const gasUsed = await publicClient.getTransactionReceipt({hash}).then(r => r.gasUsed);
        const event = (await wasabiShortPool.getEvents.PositionOpened())[0];
        const position: Position = await getEventPosition(event);

        return {
            position,
            hash,
            gasUsed,
            event,
            downPayment,
        }
    }


    const createClosePositionRequest = async (params: CreateClosePositionRequestParams): Promise<ClosePositionRequest> => {
        const { position, interest, expiration } = params;
        const amountOut = position.principal + (interest || 0n);

        let functionCallDataList: FunctionCallData[] = [];

        const wethBalance = await weth.read.balanceOf([wasabiShortPool.address]);
        if (wethBalance < amountOut && position.currency === wethAddress) {
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

    const createSignedClosePositionRequest = async (params: CreateClosePositionRequestParams): Promise<WithSignature<ClosePositionRequest>> => {
        const request = await createClosePositionRequest(params);
        const signature = await signClosePositionRequest(orderSigner, contractName, wasabiShortPool.address, request);
        return { request, signature }
    }

    const createClosePositionOrder = async (params: CreateClosePositionOrderParams): Promise<ClosePositionOrder> => {
        const { orderType, positionId, makerAmount, takerAmount, createdAt, expiration, executionFee } = params;
        const order: ClosePositionOrder = {
            orderType,
            positionId,
            makerAmount,
            takerAmount,
            createdAt: createdAt ? BigInt(createdAt) : BigInt(await time.latest()),
            expiration: expiration ? BigInt(expiration) : (BigInt(await time.latest()) + 300n),
            executionFee: executionFee || 0n
        }
        return order;
    }

    const createSignedClosePositionOrder = async (params: CreateClosePositionOrderParams): Promise<WithSignature<ClosePositionOrder>> => {
        const {traderSigner} = params;
        const order = await createClosePositionOrder(params);
        const signature = await signClosePositionOrder(traderSigner, contractName, wasabiShortPool.address, order);
        return { request: order, signature }
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

    const upgradeToV2 = async () => {
        const contractName = "MockWasabiShortPoolV2";
        const MockWasabiShortPoolV2 = await hre.ethers.getContractFactory(contractName);
        const address = 
            await hre.upgrades.upgradeProxy(
                wasabiShortPool.address,
                MockWasabiShortPoolV2
            )
            .then(c => c.waitForDeployment())
            .then(c => c.getAddress()).then(getAddress);
        return await hre.viem.getContractAt(contractName, address);
    }

    return {
        ...wasabiShortPoolFixture,
        mockSwap,
        uPPG,
        usdc,
        openPositionRequest,
        downPayment,
        signature,
        initialPPGPrice,
        initialUSDCPrice,
        priceDenominator,
        sendDefaultOpenPositionRequest,
        sendUSDCOpenPositionRequest,
        createClosePositionRequest,
        createSignedClosePositionRequest,
        createClosePositionOrder,
        createSignedClosePositionOrder,
        computeLiquidationPrice,
        computeMaxInterest,
        getBalance,
        totalAmountIn,
        signClosePositionRequest,
        upgradeToV2
    }
}

export async function deployWasabiPoolsAndRouter() {
    const perpManager = await deployPerpManager();

    const addressProviderFixture = await deployAddressProvider();
    const {addressProvider, weth} = addressProviderFixture;

    // Setup
    const [owner, user1, user2] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    // Deploy WasabiLongPool
    const WasabiLongPool = await hre.ethers.getContractFactory("WasabiLongPool");
    const longPoolAddress = 
        await hre.upgrades.deployProxy(
            WasabiLongPool,
            [addressProviderFixture.addressProvider.address, perpManager.manager.address],
            { kind: 'uups'}
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const wasabiLongPool = await hre.viem.getContractAt("WasabiLongPool", longPoolAddress);

    // Deploy WasabiShortPool
    const WasabiShortPool = await hre.ethers.getContractFactory("WasabiShortPool");
    const shortPoolAddress =
        await hre.upgrades.deployProxy(
            WasabiShortPool,
            [addressProviderFixture.addressProvider.address, perpManager.manager.address],
            { kind: 'uups'}
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const wasabiShortPool = await hre.viem.getContractAt("WasabiShortPool", shortPoolAddress);

    const uPPG = await hre.viem.deployContract("MockERC20", ["μPudgyPenguins", 'μPPG']);
    const usdc = await hre.viem.deployContract("USDC", []);

    // Deploy WETH Vault
    const wethVaultFixture = await deployVault(
        wasabiLongPool.address, addressProvider.address, weth.address, "WETH Vault", "wasabWETH");
    const wethVault = wethVaultFixture.vault;
    await wasabiLongPool.write.addVault([wethVault.address]);
    await wethVault.write.depositEth([owner.account.address], { value: parseEther("20") });

    // Deploy PPG Vault
    const ppgVaultFixture = await deployVault(
        wasabiShortPool.address, addressProvider.address, uPPG.address, "PPG Vault", "wuPPG");
    const ppgVault = ppgVaultFixture.vault;
    const amount = parseEther("50");
    await uPPG.write.mint([amount]);
    await uPPG.write.approve([ppgVault.address, amount]);
    await ppgVault.write.deposit([amount, owner.account.address]);
    await wasabiShortPool.write.addVault([ppgVault.address]);

    // Deploy WasabiRouter
    const WasabiRouter = await hre.ethers.getContractFactory("WasabiRouter");
    const routerAddress =
        await hre.upgrades.deployProxy(
            WasabiRouter,
            [longPoolAddress, shortPoolAddress, perpManager.manager.address],
            { kind: 'uups'}
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const wasabiRouter = await hre.viem.getContractAt("WasabiRouter", routerAddress);
    await addressProvider.write.setWasabiRouter([routerAddress]);

    return {
        ...addressProviderFixture,
        ...perpManager,
        wasabiLongPool,
        wasabiShortPool,
        wasabiRouter,
        wethVault,
        ppgVault,
        uPPG,
        usdc,
        owner,
        user1,
        user2,
        publicClient
    };
}

export async function deployPoolsAndRouterMockEnvironment() {
    const wasabiPoolsAndRouterFixture = await deployWasabiPoolsAndRouter();
    const {wasabiRouter, wasabiLongPool, wasabiShortPool, wethVault, ppgVault, uPPG, usdc, weth, orderSigner, orderExecutor, user1, user2, publicClient, wethAddress, debtController} = wasabiPoolsAndRouterFixture;

    const initialPPGPrice = 10_000n;    // 1 PPG = 1 WETH
    const initialUSDCPrice = 4n;        // 1 USDC = 4/10000 WETH = 1/2500 WETH
    const priceDenominator = 10_000n;

    const mockSwap = await hre.viem.deployContract("MockSwap", []);
    await weth.write.deposit([], { value: parseEther("50") });
    await weth.write.transfer([mockSwap.address, parseEther("50")]);

    await uPPG.write.mint([mockSwap.address, parseEther("10")]);
    await mockSwap.write.setPrice([uPPG.address, wethAddress, initialPPGPrice]);

    await usdc.write.mint([mockSwap.address, parseUnits("10000", 6)]);
    await mockSwap.write.setPrice([usdc.address, weth.address, initialUSDCPrice]);
    await mockSwap.write.setPrice([usdc.address, uPPG.address, initialUSDCPrice]);

    await weth.write.deposit([], { value: parseEther("50"), account: user1.account });
    await weth.write.approve([wasabiLongPool.address, maxUint256], {account: user1.account});
    await weth.write.approve([wasabiShortPool.address, maxUint256], {account: user1.account});
    await weth.write.deposit([], { value: parseEther("50"), account: user2.account });
    await weth.write.approve([wasabiLongPool.address, maxUint256], {account: user2.account});
    await weth.write.approve([wasabiShortPool.address, maxUint256], {account: user2.account});

    const leverage = 5n;
    const totalAmountIn = parseEther("1");
    const longFee = getFee(totalAmountIn * leverage, tradeFeeValue);
    const shortFee = getFee(totalAmountIn * (leverage + 1n), tradeFeeValue);
    const longDownPayment = totalAmountIn - longFee;
    const shortDownPayment = totalAmountIn - shortFee;
    const longPrincipal = longDownPayment * (leverage - 1n);
    const longTotalSize = longPrincipal + longDownPayment;
    const swappedAmount = shortDownPayment * initialPPGPrice / priceDenominator;
    const shortPrincipal = swappedAmount * leverage;
    const executionFee = parseEther("0.005");

    const longOpenPositionRequest: OpenPositionRequest = {
        id: 1n,
        currency: wethAddress,
        targetCurrency: uPPG.address,
        downPayment: longDownPayment,
        principal: longPrincipal,
        minTargetAmount: longTotalSize * initialPPGPrice / priceDenominator,
        expiration: BigInt(await time.latest()) + 86400n,
        fee: longFee,
        functionCallDataList: 
            getApproveAndSwapFunctionCallData(mockSwap.address, wethAddress, uPPG.address, longTotalSize)
    };
    const longOpenSignature = await signOpenPositionRequest(orderSigner, "WasabiLongPool", wasabiLongPool.address, longOpenPositionRequest);
    
    const shortOpenPositionRequest: OpenPositionRequest = {
        id: 1n,
        currency: uPPG.address,
        targetCurrency: wethAddress,
        downPayment: shortDownPayment,
        principal: shortPrincipal,
        minTargetAmount: shortPrincipal * initialPPGPrice / priceDenominator,
        expiration: BigInt(await time.latest()) + 86400n,
        fee: shortFee,
        functionCallDataList: 
            getApproveAndSwapFunctionCallData(mockSwap.address, uPPG.address, wethAddress, shortPrincipal)
    };
    const shortOpenSignature = await signOpenPositionRequest(orderSigner, "WasabiShortPool", wasabiShortPool.address, shortOpenPositionRequest);

    const sendDefaultLongOpenPositionRequest = async (id?: bigint | undefined) => {
        const request = id ? {...longOpenPositionRequest, id} : longOpenPositionRequest;
        const signature = await signOpenPositionRequest(orderSigner, "WasabiLongPool", wasabiLongPool.address, request);
        const hash = await wasabiLongPool.write.openPosition([request, signature], { account: user1.account });
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

    const sendRouterLongOpenPositionRequest = async (id?: bigint | undefined) => {
        const request = id ? {...longOpenPositionRequest, id} : longOpenPositionRequest;
        const routerRequest = {...request, functionCallDataList: []};
        const signature = await signOpenPositionRequest(orderSigner, "WasabiLongPool", wasabiLongPool.address, request);
        const traderSig = await signOpenPositionRequest(user1, "WasabiRouter", wasabiRouter.address, routerRequest);
        const hash = await wasabiRouter.write.openPosition(
            [wasabiLongPool.address, request, signature, traderSig, executionFee], 
            { account: orderExecutor.account }
        );
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

    const sendDefaultShortOpenPositionRequest = async (id?: bigint | undefined) => {
        const request = id ? {...shortOpenPositionRequest, id} : shortOpenPositionRequest;
        const signature = await signOpenPositionRequest(orderSigner, "WasabiShortPool", wasabiShortPool.address, request);
        const hash = await wasabiShortPool.write.openPosition([request, signature], { account: user1.account });
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

    const sendRouterShortOpenPositionRequest = async (id?: bigint | undefined) => {
        const request = id ? {...shortOpenPositionRequest, id} : shortOpenPositionRequest;
        const routerRequest = {...request, functionCallDataList: []};
        const signature = await signOpenPositionRequest(orderSigner, "WasabiShortPool", wasabiShortPool.address, request);
        const traderSig = await signOpenPositionRequest(user1, "WasabiRouter", wasabiRouter.address, routerRequest);
        const hash = await wasabiRouter.write.openPosition(
            [wasabiShortPool.address, request, signature, traderSig, executionFee], 
            { account: orderExecutor.account }
        );
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

    const createCloseLongPositionRequest = async (params: CreateClosePositionRequestParams): Promise<ClosePositionRequest> => {
        const { position, interest, expiration } = params;
        const request: ClosePositionRequest = {
            expiration: expiration ? BigInt(expiration) : (BigInt(await time.latest()) + 300n),
            interest: interest || 0n,
            position,
            functionCallDataList: getApproveAndSwapFunctionCallData(mockSwap.address, position.collateralCurrency, position.currency, position.collateralAmount),
        };
        return request;
    }

    const createCloseShortPositionRequest = async (params: CreateClosePositionRequestParams): Promise<ClosePositionRequest> => {
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

    const createSignedCloseLongPositionRequest = async (params: CreateClosePositionRequestParams): Promise<WithSignature<ClosePositionRequest>> => {
        const request = await createCloseLongPositionRequest(params);
        const signature = await signClosePositionRequest(orderSigner, "WasabiLongPool", wasabiLongPool.address, request);
        return { request, signature }
    }

    const createSignedCloseShortPositionRequest = async (params: CreateClosePositionRequestParams): Promise<WithSignature<ClosePositionRequest>> => {
        const request = await createCloseShortPositionRequest(params);
        const signature = await signClosePositionRequest(orderSigner, "WasabiShortPool", wasabiShortPool.address, request);
        return { request, signature }
    }

    const computeLongMaxInterest = async (position: Position): Promise<bigint> => {
        return await debtController.read.computeMaxInterest([position.collateralCurrency, position.principal, position.lastFundingTimestamp], { blockTag: 'pending' });
    }

    const computeLongLiquidationPrice = async (position: Position): Promise<bigint> => {
        const threshold = 500n; // 5 percent

        const currentInterest = await computeLongMaxInterest(position);
        const payoutLiquidationThreshold = position.principal * (threshold + tradeFeeValue) / (feeDenominator - tradeFeeValue);

        const liquidationAmount = payoutLiquidationThreshold + position.principal + currentInterest;
        return liquidationAmount * priceDenominator / position.collateralAmount;
    }

    const computeShortMaxInterest = async (position: Position): Promise<bigint> => {
        return await debtController.read.computeMaxInterest([position.currency, position.principal, position.lastFundingTimestamp], { blockTag: 'pending' });
    }

    const computeShortLiquidationPrice = async (position: Position): Promise<bigint> => {
        const threshold = 500n; // 5 percent

        const currentInterest = await computeShortMaxInterest(position);
        const payoutLiquidationThreshold = position.collateralAmount * (threshold + tradeFeeValue) / (feeDenominator - tradeFeeValue);

        const liquidationAmount = position.collateralAmount - payoutLiquidationThreshold;
        return liquidationAmount * priceDenominator / (position.principal + currentInterest);
    }

    const upgradeToV2 = async (withdrawAmountFromLong: bigint) => {
        // Upgrade vaults
        const WasabiVaultV2 = await hre.ethers.getContractFactory("WasabiVaultV2");
        const wethVaultAddress = 
            await hre.upgrades.upgradeProxy(
                wethVault.address,
                WasabiVaultV2,
                { 
                    call: { fn: "reinitialize", args: [
                        wasabiLongPool.address, 
                        wasabiShortPool.address, 
                        withdrawAmountFromLong
                    ]}
                }
            )
            .then(c => c.waitForDeployment())
            .then(c => c.getAddress()).then(getAddress);
        const wethVaultV2 = await hre.viem.getContractAt("WasabiVaultV2", wethVaultAddress);
        const ppgVaultAddress = 
            await hre.upgrades.upgradeProxy(
                ppgVault.address,
                WasabiVaultV2,
                { 
                    call: { fn: "reinitialize", args: [
                        wasabiLongPool.address, 
                        wasabiShortPool.address, 
                        0n
                    ]}
                }
            )
            .then(c => c.waitForDeployment())
            .then(c => c.getAddress()).then(getAddress);
        const ppgVaultV2 = await hre.viem.getContractAt("WasabiVaultV2", ppgVaultAddress);
        
        // Upgrade pools
        const WasabiLongPoolV2 = await hre.ethers.getContractFactory("WasabiLongPoolV2");
        const longPoolAddress =
            await hre.upgrades.upgradeProxy(
                wasabiLongPool.address,
                WasabiLongPoolV2,
            )
            .then(c => c.waitForDeployment())
            .then(c => c.getAddress()).then(getAddress);
        const wasabiLongPoolV2 = await hre.viem.getContractAt("WasabiLongPoolV2", longPoolAddress);
        const WasabiShortPoolV2 = await hre.ethers.getContractFactory("WasabiShortPoolV2");
        const shortPoolAddress =
            await hre.upgrades.upgradeProxy(
                wasabiShortPool.address,
                WasabiShortPoolV2,
            )
            .then(c => c.waitForDeployment())
            .then(c => c.getAddress()).then(getAddress);
        const wasabiShortPoolV2 = await hre.viem.getContractAt("WasabiShortPoolV2", shortPoolAddress);

        // Add WETH vault to short pool
        await wasabiShortPoolV2.write.addVault([wethVaultV2.address]);

        return {
            wasabiLongPoolV2,
            wasabiShortPoolV2,
            wethVaultV2,
            ppgVaultV2
        }
    }

    return {
        ...wasabiPoolsAndRouterFixture,
        mockSwap,
        leverage,
        totalAmountIn,
        longDownPayment,
        shortDownPayment,
        longPrincipal,
        shortPrincipal,
        longOpenPositionRequest,
        longOpenSignature,
        shortOpenPositionRequest,
        shortOpenSignature,
        initialPPGPrice,
        priceDenominator,
        executionFee,
        sendDefaultLongOpenPositionRequest,
        sendDefaultShortOpenPositionRequest,
        sendRouterLongOpenPositionRequest,
        sendRouterShortOpenPositionRequest,
        createCloseLongPositionRequest,
        createSignedCloseLongPositionRequest,
        createCloseShortPositionRequest,
        createSignedCloseShortPositionRequest,
        computeLongMaxInterest,
        computeLongLiquidationPrice,
        computeShortMaxInterest,
        computeShortLiquidationPrice,
        upgradeToV2
    }
}