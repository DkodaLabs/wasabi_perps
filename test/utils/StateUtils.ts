
import { PublicClient, getAddress } from "viem";

export async function takeBalanceSnapshot(client: PublicClient, ...address: string[]): Promise<Map<string, bigint>> {
    const balances = await Promise.all(address.map(getAddress).map(a => client.getBalance({address: a})));
    const balanceMap = new Map<string, bigint>();
    for (let i = 0; i < address.length; i++) {
        balanceMap.set(address[i], balances[i]);
    }
    return balanceMap;
}