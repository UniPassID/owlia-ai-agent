import { JsonRpcProvider } from "ethers";
import { createPublicClient, http, PublicClient } from "viem";

/**
 * RPC endpoints configuration for different chains
 * Centralized configuration to avoid duplication
 */
export const RPC_ENDPOINTS: Record<string, string> = {
  "1": process.env.ETH_RPC_URL || "https://eth.llamarpc.com",
  "56": process.env.BSC_RPC_URL || "https://bsc-dataseed.binance.org",
  "8453": process.env.BASE_RPC_URL || "https://mainnet.base.org",
  "42161": process.env.ARB_RPC_URL || "https://arb1.arbitrum.io/rpc",
  "10": process.env.OP_RPC_URL || "https://mainnet.optimism.io",
};

export const RPC_PROVIDERS: Record<string, JsonRpcProvider> = {
  "1": new JsonRpcProvider(RPC_ENDPOINTS["1"]),
  "56": new JsonRpcProvider(RPC_ENDPOINTS["56"]),
  "8453": new JsonRpcProvider(RPC_ENDPOINTS["8453"]),
  "42161": new JsonRpcProvider(RPC_ENDPOINTS["42161"]),
  "10": new JsonRpcProvider(RPC_ENDPOINTS["10"]),
};
/**
 * Get RPC URL for a given chain ID
 */
export function getRpcUrl(chainId: string): string | undefined {
  return RPC_ENDPOINTS[chainId];
}
