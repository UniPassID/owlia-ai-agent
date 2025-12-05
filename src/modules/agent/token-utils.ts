/**
 * Token address mapping by chain ID
 */
export const TOKEN_ADDRESS_BY_CHAIN: Record<string, Record<string, string>> = {
  '8453': {
    USDC: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    USDT: '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
    // OUSDT: '0x1217bfe6c773eec6cc4a38b5dc45b92292b6e189',
  },
  '56': {
    USDT: '0x55d398326f99059ff775485246999027b3197955',
    USDC: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
    USD1: '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d',
    // DAI: '0x1af3f329e8be154074d8769d1ffa4ee058b1dbc3',
  },
};

/**
 * Token decimals mapping by chain ID
 */
export const TOKEN_DECIMALS_BY_CHAIN: Record<string, Record<string, number>> = {
  '8453': {
    USDC: 6,
    USDT: 6,
    // OUSDT: 6,
  },
  '56': {
    USDT: 18,
    USDC: 18,
    USD1: 18,
    // DAI: 18,
  },
};

/**
 * Lookup token address by symbol and chain ID
 * @param symbol - Token symbol (e.g., "USDC", "USDT")
 * @param chainId - Chain ID (e.g., "8453" for Base)
 * @returns Token address or null if not found
 */
export function lookupTokenAddress(
  symbol: string,
  chainId: string,
): string | null {
  if (!symbol) {
    return null;
  }

  const chainMap = TOKEN_ADDRESS_BY_CHAIN[chainId];
  if (!chainMap) {
    return null;
  }

  return chainMap[symbol.toUpperCase()] || null;
}

/**
 * Reverse lookup: Get token symbol by address and chain ID
 * @param address - Token contract address
 * @param chainId - Chain ID (e.g., "8453" for Base)
 * @returns Token symbol or null if not found
 */
export function lookupTokenSymbol(
  address: string,
  chainId: string,
): string | null {
  if (!address || !chainId) {
    return null;
  }

  const chainMap = TOKEN_ADDRESS_BY_CHAIN[chainId];
  if (!chainMap) {
    return null;
  }

  const normalizedAddress = address.toLowerCase();

  // Search through the chain's token map
  for (const [symbol, tokenAddress] of Object.entries(chainMap)) {
    if (tokenAddress.toLowerCase() === normalizedAddress) {
      return symbol;
    }
  }

  return null;
}

/**
 * Lookup token decimals by symbol and chain ID
 * @param symbol - Token symbol
 * @param chainId - Chain ID
 * @returns Number of decimals or null if not found
 */
export function lookupTokenDecimals(
  symbol: string,
  chainId: string,
): number | null {
  if (!symbol) {
    return null;
  }

  const chainMap = TOKEN_DECIMALS_BY_CHAIN[chainId];
  if (!chainMap) {
    return null;
  }

  const decimals = chainMap[symbol.toUpperCase()];
  return typeof decimals === 'number' ? decimals : null;
}
