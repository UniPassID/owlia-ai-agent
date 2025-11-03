/**
 * Transaction parser types for rebalance action analysis
 */

export enum RebalanceActionType {
  // DEX LP actions (Position Manager)
  ADD_LIQUIDITY = 'ADD_LIQUIDITY',
  REMOVE_LIQUIDITY = 'REMOVE_LIQUIDITY',

  // Uniswap V3 Pool direct actions
  POOL_MINT = 'POOL_MINT',
  POOL_BURN = 'POOL_BURN',
  POOL_COLLECT = 'POOL_COLLECT',

  // Swap actions
  SWAP = 'SWAP',

  // Lending actions
  SUPPLY = 'SUPPLY',
  WITHDRAW = 'WITHDRAW',
  BORROW = 'BORROW',
  REPAY = 'REPAY',
}

export enum Protocol {
  // DEX
  UNISWAP_V2 = 'UNISWAP_V2',
  UNISWAP_V3 = 'UNISWAP_V3',
  AERODROME = 'AERODROME',

  // Aggregators
  OKX_ROUTER = 'OKX_ROUTER',
  KYBERSWAP_ROUTER = 'KYBERSWAP_ROUTER',

  // Lending
  AAVE = 'AAVE',
  EULER = 'EULER',
  VENUS = 'VENUS',
}

export interface TokenAmount {
  token: string; // Token address
  symbol?: string; // Token symbol (optional)
  amount: string; // Amount in wei/smallest unit
  decimals?: number; // Token decimals
  amountFormatted?: string; // Human readable amount
}

export interface RebalanceAction {
  type: RebalanceActionType;
  protocol: Protocol;
  tokens: TokenAmount[];
  metadata?: Record<string, any>;
  eventIndex: number; // Original event index in transaction
  logIndex: number; // Log index in transaction receipt
}

export interface ParsedTransaction {
  transactionHash: string;
  blockNumber: number;
  timestamp?: number;
  actions: RebalanceAction[];
  rawLogs?: any[]; // Original logs for debugging
}

export interface EventSignature {
  name: string;
  signature: string; // Full signature including 'indexed' keywords
  protocol: Protocol;
  actionType: RebalanceActionType;
  abi?: any; // Full ABI definition (optional, for complex events)
}
