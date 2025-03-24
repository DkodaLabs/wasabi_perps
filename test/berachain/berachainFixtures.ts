import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import type { Address } from 'abitype'
import hre from "hardhat";
import { mine } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { deployAddressProvider, deployPerpManager } from "../fixtures";
import { parseEther, zeroAddress, getAddress, maxUint256, encodeFunctionData, parseUnits, EncodeFunctionDataReturnType } from "viem";
import { ClosePositionRequest, ClosePositionOrder, OrderType, FunctionCallData, OpenPositionRequest, Position, Vault, WithSignature, getEventPosition, getFee, getValueWithoutFee } from "../utils/PerpStructUtils";
import { Signer, signClosePositionRequest, signClosePositionOrder, signOpenPositionRequest } from "../utils/SigningUtils";
import { getApproveAndSwapExactlyOutFunctionCallData, getApproveAndSwapFunctionCallData, getRouterSwapExactlyOutFunctionCallData, getRouterSwapFunctionCallData, getSwapExactlyOutFunctionCallData, getSwapFunctionCallData, getSweepTokenWithFeeCallData, getUnwrapWETH9WithFeeCallData } from "../utils/SwapUtils";
import { WETHAbi } from "../utils/WETHAbi";
import { LIQUIDATOR_ROLE, ORDER_SIGNER_ROLE, ORDER_EXECUTOR_ROLE, VAULT_ADMIN_ROLE } from "../utils/constants";
import { MockSwapRouterAbi } from "../utils/MockSwapRouterAbi";

export const beaconDepositAddress = "0x4242424242424242424242424242424242424242";
export const validatorPubKey = "0x696969696969696969696969696969696969696969696969696969696969696969696969696969696969696969696969";

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

export type CreateExactInSwapDataParams = {
    amount: bigint,
    tokenIn: Address,
    tokenOut: Address,
    swapRecipient: Address,
    swapFee?: bigint,
    unwrapEth?: boolean
}

export type CreateExactOutSwapDataParams = {
    amountInMax: bigint,
    amountOut: bigint,
    tokenIn: Address,
    tokenOut: Address,
    swapRecipient: Address,
    swapFee?: bigint,
    unwrapEth?: boolean
}

export type Weight = {
    receiver: Address,
    percentageNumerator: bigint
}

export type RewardAllocation = {
    startBlock: bigint,
    weights: Weight[]
}

export async function deployBGT() {
    const [owner] = await hre.viem.getWalletClients();
    const contractName = "MockBGT";
    const BGT = await hre.ethers.getContractFactory(contractName);
    const address = 
        await hre.upgrades.deployProxy(
            BGT,
            [owner.account.address],
            { kind: 'transparent', unsafeAllow: ['missing-initializer-call', 'missing-initializer']} // BGT initializer doesn't call __EIP712_init
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const bgt = await hre.viem.getContractAt(contractName, address);
    return { bgt };
}

export async function deployBeaconDepositContract() {
    const [owner] = await hre.viem.getWalletClients();
    const beaconDeposit = await hre.viem.deployContract("BeaconDepositMock");
    await beaconDeposit.write.setOperator([
        validatorPubKey,
        owner.account.address
    ]);
    return { beaconDeposit };
}

export async function deployPOL() {
    await hre.upgrades.silenceWarnings();
    const [owner] = await hre.viem.getWalletClients();
    const { bgt } = await deployBGT();
    const { beaconDeposit } = await deployBeaconDepositContract();

    const usdc = await hre.viem.deployContract("USDC", []);
    
    // Deploy all POL contracts before initializing them
    const BeraChef = await hre.ethers.getContractFactory("BeraChef");
    const beraChefAddress = 
        await hre.upgrades.deployProxy(
            BeraChef,
            {kind: 'transparent', initializer: false} 
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const beraChef = await hre.viem.getContractAt("BeraChef", getAddress(beraChefAddress));

    const BlockRewardController = await hre.ethers.getContractFactory("BlockRewardController");
    const blockRewardControllerAddress =
        await hre.upgrades.deployProxy(
            BlockRewardController,
            {kind: 'transparent', initializer: false} 
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const blockRewardController = await hre.viem.getContractAt("BlockRewardController", getAddress(blockRewardControllerAddress));

    const Distributor = await hre.ethers.getContractFactory("BerachainDistributorMock");
    const distributorAddress = 
        await hre.upgrades.deployProxy(
            Distributor,
            {kind: 'transparent', initializer: false} 
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const distributor = await hre.viem.getContractAt("BerachainDistributorMock", getAddress(distributorAddress));

    const RewardVault = await hre.ethers.getContractFactory("RewardVault");
    const rewardVaultImplAddress = await RewardVault.deploy()
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const RewardVaultFactory = await hre.ethers.getContractFactory("RewardVaultFactory");
    const rewardVaultFactoryAddress = 
        await hre.upgrades.deployProxy(
            RewardVaultFactory,
            {kind: 'transparent', initializer: false} 
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const rewardVaultFactory = await hre.viem.getContractAt("RewardVaultFactory", getAddress(rewardVaultFactoryAddress));

    const BGTStaker = await hre.ethers.getContractFactory("BGTStaker");
    const bgtStakerAddress =
        await hre.upgrades.deployProxy(
            BGTStaker,
            [bgt.address, owner.account.address, owner.account.address, usdc.address],
            {kind: 'transparent'} 
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const bgtStaker = await hre.viem.getContractAt("BGTStaker", getAddress(bgtStakerAddress));
    await bgt.write.setStaker([bgtStaker.address]);

    // Initialize POL contracts now that we have all the addresses
    await beraChef.write.initialize([
        distributor.address,
        rewardVaultFactory.address,
        owner.account.address,
        beaconDeposit.address,
        10
    ]);
    await blockRewardController.write.initialize([
        bgt.address,
        distributor.address,
        beaconDeposit.address,
        owner.account.address
    ]);
    await distributor.write.initialize([
        beraChef.address,
        bgt.address,
        blockRewardController.address,
        owner.account.address
    ]);
    await rewardVaultFactory.write.initialize([
        bgt.address,
        distributor.address,
        beaconDeposit.address,
        owner.account.address,
        rewardVaultImplAddress
    ]);
    // Mint some initial BGT and use it to boost the validator
    await bgt.write.setMinter([owner.account.address]);
    await bgt.write.setActivateBoostDelay([1000]);
    // Invariant check in BGT requires address(this).balance >= totalSupply
    await owner.sendTransaction({to: bgt.address, value: parseEther("100")}); 
    await bgt.write.mint([owner.account.address, parseEther("10")]);
    // Boost must be queued at least activateBoostDelay blocks before activation
    await bgt.write.queueBoost([validatorPubKey, parseEther("10")], {account: owner.account});
    await mine(1000);
    await bgt.write.activateBoost([owner.account.address, validatorPubKey], {account: owner.account});
    // Now change the minter to the BlockRewardController and make sure the Distributor can transfer BGT
    await bgt.write.setMinter([blockRewardController.address], {account: owner.account});
    await bgt.write.whitelistSender([distributor.address, true], {account: owner.account});
    await blockRewardController.write.setMinBoostedRewardRate([parseEther("1")], {account: owner.account});

    return { usdc, bgt, beaconDeposit, blockRewardController, beraChef, distributor, rewardVaultFactory };
}

export async function deployVault(longPoolAddress: Address, shortPoolAddress: Address, addressProvider: Address, perpManager: Address, tokenAddress: Address, name: string, symbol: string, factoryAddress: Address) {
    const contractName = "MockBeraVault";
    const BeraVault = await hre.ethers.getContractFactory(contractName);
    const address = 
        await hre.upgrades.deployProxy(
            BeraVault,
            { kind: 'uups', initializer: false, unsafeAllow: ['missing-initializer-call']}
        )
        .then(c => c.waitForDeployment())
        .then(c => c.getAddress()).then(getAddress);
    const vault = await hre.viem.getContractAt(contractName, address);
    await vault.write.initializeWithFactory([longPoolAddress, shortPoolAddress, addressProvider, perpManager, tokenAddress, name, symbol, factoryAddress]);
    const rewardVaultAddress = await vault.read.rewardVault();
    const rewardVault = await hre.viem.getContractAt("RewardVault", getAddress(rewardVaultAddress));
    return { vault, rewardVault }
}

export async function deployWasabiLongPool() {
    const perpManager = await deployPerpManager();
    const addressProviderFixture = await deployAddressProvider();
    const {addressProvider, weth: wbera} = addressProviderFixture;
    const polFixture = await deployPOL();
    const {rewardVaultFactory, beraChef, blockRewardController} = polFixture;

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

    // Deploy BeraVault
    const vaultFixture = await deployVault(
        wasabiLongPool.address, zeroAddress, addressProvider.address, perpManager.manager.address, wbera.address, "WBERA Vault", "wWBERA", rewardVaultFactory.address);
    const vault = vaultFixture.vault;
    const rewardVault = vaultFixture.rewardVault;
    await wasabiLongPool.write.addVault([vault.address], {account: perpManager.vaultAdmin.account});
    await vault.write.depositEth([owner.account.address], { value: parseEther("20") });
    
    // Set up rewards
    await rewardVault.write.setOperator([vault.address], {account: owner.account});
    await rewardVault.write.whitelistIncentiveToken([wbera.address, parseEther("1"), owner.account.address], {account: owner.account});
    const incentiveAmount = parseEther("100");
    const incentiveRate = parseEther("10");
    await wbera.write.deposit({ value: incentiveAmount, account: owner.account });
    await wbera.write.approve([rewardVault.address, incentiveAmount], {account: owner.account});
    await rewardVault.write.addIncentive([wbera.address, incentiveAmount, incentiveRate], {account: owner.account});
    const hash = await beraChef.write.setVaultWhitelistedStatus([rewardVault.address, true, ""], {account: owner.account});
    const startBlock = await publicClient.getTransactionReceipt({hash}).then(r => r.blockNumber);
    const rewardAllocation: RewardAllocation = {
        startBlock,
        weights: [
            {receiver: rewardVault.address, percentageNumerator: 10000n}
        ]
    };
    await beraChef.write.setDefaultRewardAllocation([rewardAllocation], {account: owner.account});
    await blockRewardController.write.setBaseRate([parseEther("1")], {account: owner.account});
    await blockRewardController.write.setRewardRate([parseEther("1")], {account: owner.account});

    return {
        ...vaultFixture,
        ...addressProviderFixture,
        ...perpManager,
        ...polFixture,
        wasabiLongPool,
        wbera,
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
    const {addressProvider, weth: wbera} = addressProviderFixture;
    const polFixture = await deployPOL();
    const {rewardVaultFactory} = polFixture;

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
        longPoolAddress, wasabiShortPool.address, addressProvider.address, perpManager.manager.address, uPPG.address, "PPG Vault", "wuPPG", rewardVaultFactory.address);
    const {vault, rewardVault} = vaultFixture;

    // Deploy WETH & USDC Vaults
    const usdcVaultFixture = await deployVault(
        wasabiLongPool.address, wasabiShortPool.address, addressProvider.address, perpManager.manager.address, usdc.address, "USDC Vault", "wUSDC", rewardVaultFactory.address);
    const usdcVault = usdcVaultFixture.vault;
    const wberaVaultFixture = await deployVault(
        wasabiLongPool.address, wasabiShortPool.address, addressProvider.address, perpManager.manager.address, wbera.address, "WBERA Vault", "wWBERA", rewardVaultFactory.address);
    const wberaVault = wberaVaultFixture.vault;

    const amount = parseEther("50");
    await uPPG.write.mint([amount]);
    await uPPG.write.approve([vault.address, amount]);
    await vault.write.deposit([amount, owner.account.address]);
    await wasabiShortPool.write.addVault([vault.address], {account: perpManager.vaultAdmin.account});
    await wasabiShortPool.write.addVault([wberaVault.address], {account: perpManager.vaultAdmin.account});
    await wasabiShortPool.write.addVault([usdcVault.address], {account: perpManager.vaultAdmin.account});
    await wasabiLongPool.write.addVault([wberaVault.address], {account: perpManager.vaultAdmin.account});
    await wasabiLongPool.write.addVault([usdcVault.address], {account: perpManager.vaultAdmin.account});

    return {
        ...addressProviderFixture,
        ...perpManager,
        ...polFixture,
        wasabiShortPool,
        wasabiLongPool,
        owner,
        user1,
        user2,
        publicClient,
        contractName,
        uPPG,
        usdc,
        wbera,
        usdcVault,
        wberaVault,
        vault,
        rewardVault
    };
}

export async function deployLongPoolMockEnvironment() {
    const wasabiLongPoolFixture = await deployWasabiLongPool();
    const {tradeFeeValue, contractName, wasabiLongPool, user1, user2, publicClient, feeDenominator, debtController, wbera, orderSigner} = wasabiLongPoolFixture;
    const [owner] = await hre.viem.getWalletClients();

    const initialPrice = 10_000n;
    const priceDenominator = 10_000n;
    const leverage = 4n;

    const mockSwap = await hre.viem.deployContract("MockSwap", []);
    await wbera.write.deposit([], { value: parseEther("50") });
    await wbera.write.transfer([mockSwap.address, parseEther("50")]);

    const uPPG = await hre.viem.deployContract("MockERC20", ["μPudgyPenguins", 'μPPG']);
    await uPPG.write.mint([mockSwap.address, parseEther("50")]);
    await mockSwap.write.setPrice([uPPG.address, wbera.address, initialPrice]);

    const totalAmountIn = parseEther("1");
    const fee = getFee(totalAmountIn * leverage, tradeFeeValue);
    const downPayment = totalAmountIn - fee;
    const principal = downPayment * (leverage - 1n);
    const totalSize = principal + downPayment;

    const functionCallDataList: FunctionCallData[] =
        getApproveAndSwapFunctionCallData(mockSwap.address, wbera.address, uPPG.address, totalSize);

    await wbera.write.deposit([], { value: parseEther("50"), account: user1.account });
    await wbera.write.approve([wasabiLongPool.address, maxUint256], {account: user1.account});
    await wbera.write.deposit([], { value: parseEther("50"), account: user2.account });
    await wbera.write.approve([wasabiLongPool.address, maxUint256], {account: user2.account});

    const openPositionRequest: OpenPositionRequest = {
        id: 1n,
        currency: wbera.address,
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