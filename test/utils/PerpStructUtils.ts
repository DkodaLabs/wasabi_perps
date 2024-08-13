import { time } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import type { Address } from 'abitype'
import {formatEther} from "viem";
import { Signature } from "./SigningUtils";

export enum OrderType {
  TP,
  SL,
  INVALID
}

export type WithSignature<T> = {
  request: T;
  signature: Signature;
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
    fee: bigint;
    functionCallDataList: FunctionCallData[];
}

export type ClosePositionRequest = {
  expiration: bigint;
  interest: bigint;
  position: Position;
  functionCallDataList: FunctionCallData[];
}

export type ClosePositionOrder = {
  orderType: OrderType;
  positionId: bigint;
  orderTime: bigint;
  expiration: bigint;
  makerAmount: bigint;
  takerAmount: bigint;
  executionFee: bigint;
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
  feesToBePaid: bigint;
}

export type Vault = {
  address: Address;
  token: Address;
  name: string;
  symbol: string;
}

export function getValueWithFee(amount: bigint, tradeFeeValue: bigint): bigint {
    return amount + getFee(amount, tradeFeeValue);
}
export function getValueWithoutFee(amount: bigint, tradeFeeValue: bigint): bigint {
    return amount - getFee(amount, tradeFeeValue);
}

export function getFee(amount: bigint, tradeFeeValue: bigint): bigint {
    return amount * tradeFeeValue / 10_000n;
}

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
      feesToBePaid: event.args.feesToBePaid!,
  }
}

export function formatEthValue(value: bigint, numDigits = 4): string {
  return Number(formatEther(value)).toFixed(numDigits) + " ETH"
}