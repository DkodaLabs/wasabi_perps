import type { Address } from 'abitype'
import {getAddress, encodeFunctionData, zeroAddress} from "viem";

import { FunctionCallData } from "./PerpStructUtils";
import {MockSwapAbi} from "./MockSwapAbi";
import { ERC20Abi } from './ERC20Abi';

export function getApproveAndSwapFunctionCallData(
    address: Address,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint
): FunctionCallData[] {
    const callDatas: FunctionCallData[] = [];
    if (tokenIn != zeroAddress) {
        const approveFunctionCallData = getERC20ApproveFunctionCallData(tokenIn, address, amountIn);
        callDatas.push(approveFunctionCallData);
    }
    const swapFunctionCallData = getSwapFunctionCallData(address, tokenIn, tokenOut, amountIn);
    callDatas.push(swapFunctionCallData);
    return callDatas;
}

export function getRevertingSwapFunctionCallData(address: Address): FunctionCallData {
    return {
        to: address,
        value: 0n,
        data: encodeFunctionData({
            abi: [MockSwapAbi.find(a => a.type === "function" && a.name === "revertingFunction")!],
            functionName: "revertingFunction",
        })
    };
}

export function getSwapFunctionCallData(
    address: Address,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
): FunctionCallData {
    return {
        to: getAddress(address),
        value: tokenIn === zeroAddress ? amountIn : 0n,
        data: encodeFunctionData({
            abi: [MockSwapAbi.find(a => a.type === "function" && a.name === "swap")!],
            functionName: "swap",
            args: [tokenIn, amountIn, tokenOut]
        })
    }
}

export function getSwapExactlyOutFunctionCallData(
    address: Address,
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    amountOut: bigint,
): FunctionCallData {
    return {
        to: getAddress(address),
        value: tokenIn === zeroAddress ? amountIn : 0n,
        data: encodeFunctionData({
            abi: [MockSwapAbi.find(a => a.type === "function" && a.name === "swapExactlyOut")!],
            functionName: "swapExactlyOut",
            args: [tokenIn, tokenOut, amountOut]
        })
    }
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