import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import type { Address } from 'abitype'
import { getAddress, parseGwei, parseEther, hexToSignature, encodeFunctionData, SignTypedDataParameters, Hex} from "viem";
import hre from "hardhat";
import { ERC20Abi } from './ERC20Abi';
import { HardhatRuntimeEnvironment, HardhatUserConfig } from 'hardhat/types';
import { string } from 'hardhat/internal/core/params/argumentTypes';

export type Account = {
  address: Address;
}
export type Wallet = {
  signTypedData: (data: SignTypedDataParameters) => Promise<Hex>;
  account: Account;
}

export type Signature = {
  v: number;
  r: Hex;
  s: Hex;
}

export type FunctionCallData = {
  to: Address;
  value: bigint;
  data: `0x${string}`;
}

export type OpenPositionRequest = {
    id: bigint;
    currency: Address;
    targetCurrency: Address;
    downPayment: bigint;
    principal: bigint;
    minTargetAmount: bigint;
    expiration: bigint;
    functionCallDataList: FunctionCallData[];
}
export type ClosePositionRequest = {
  position: Position;
  functionCallDataList: FunctionCallData[];
}

export type Position = {
  id: bigint;
  trader: Address;
  currency: Address;
  collateralCurrency: Address;
  lastFundingTimestamp: bigint;
  downPayment: bigint;
  principal: bigint;
  collateralAmount: bigint;
}

export function getValueWithFee(amount: bigint, feeValue: bigint): bigint {
    return amount + getFee(amount, feeValue);
}
export function getValueWithoutFee(amount: bigint, feeValue: bigint): bigint {
    return amount - getFee(amount, feeValue);
}

export function getFee(amount: bigint, feeValue: bigint): bigint {
    return amount * feeValue / 10_000n;
}

export function getERC20ApproveFunctionCallData(token: Address, operator: Address, value: bigint): FunctionCallData {
    const data = encodeFunctionData({
        abi: [ERC20Abi.find(a => a.name === "approve")!],
        functionName: "approve",
        args: [operator, value]
    });

    const functionCallData: FunctionCallData = {
        to: token,
        value: 0n,
        data
    }
    return functionCallData;
}

export type EIP712Domain = {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
}

export function getDomainData(verifyingContract: Address): EIP712Domain {
    const chainId = hre.network.config.chainId!;
    return {
        name: "WasabiPerps",
        version: "1",
        chainId: 0,
        verifyingContract,
    };
}

export async function signOpenPositionRequest(signer: Wallet, verifyingContract: Address, request: OpenPositionRequest): Promise<Signature> {
  const domain = getDomainData(verifyingContract);
  const typeData: SignTypedDataParameters = {
    account: signer.account.address,
    types: {
      EIP712Domain: EIP712DomainTypes,
      OpenPositionRequest: OpenPositionRequestTypes,
      FunctionCallData: FunctionCallDataTypes,
    },
    primaryType: "OpenPositionRequest",
    domain,
    message: request,
  };

  const signature = await signer.signTypedData(typeData);
  const signatureData = hexToSignature(signature);
  return {
    v: Number(signatureData.v),
    r: signatureData.r,
    s: signatureData.s,
  };
}

const EIP712DomainTypes = [
    { name: "name", type: "string" },
    { name: "version", type: "string" },
    { name: "chainId", type: "uint256" },
    { name: "verifyingContract", type: "address" },
];

const FunctionCallDataTypes = [
  { name: "to", type: "address" },
  { name: "value", type: "uint256" },
  { name: "data", type: "bytes" },
];

const OpenPositionRequestTypes = [
  { name: "id", type: "uint256" },
  { name: "currency", type: "address" },
  { name: "targetCurrency", type: "address" },
  { name: "downPayment", type: "uint256" },
  { name: "principal", type: "uint256" },
  { name: "minTargetAmount", type: "uint256" },
  { name: "expiration", type: "uint256" },
  { name: "functionCallDataList", type: "FunctionCallData[]" },
]

export async function getEventPosition(event: any): Promise<Position> {
  return {
      id: event.args.positionId!,
      trader: event.args.trader!,
      currency: event.args.currency!,
      collateralCurrency: event.args.collateralCurrency!,
      lastFundingTimestamp: BigInt(await time.latest()),
      downPayment: event.args.downPayment!,
      principal: event.args.principal!,
      collateralAmount: event.args.collateralAmount!,
  }
}