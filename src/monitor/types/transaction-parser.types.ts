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
  tokenId?: string; // NFT tokenId for Uniswap V3 positions (for POOL_MINT/POOL_BURN and ADD_LIQUIDITY/REMOVE_LIQUIDITY)
  contractAddress?: string; // Contract address that emitted the event (e.g., Euler vault address)
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

/**
 * Single event related to a position
 */
export interface PositionEvent {
  txHash: string;
  timestamp?: number;
  blockNumber: number;
  eventIndex: number;
  logIndex: number;
  type: RebalanceActionType;
  token0: string;
  token1: string;
  token0Amount: bigint;
  token1Amount: bigint;
  token0Symbol?: string;
  token1Symbol?: string;
  // For lending positions: running balance after this event
  runningBalance?: bigint;
  formattedRunningBalance?: string;
}

/**
 * Position tracking for a specific tokenId across multiple transactions
 */
export interface PositionTracking {
  tokenId: string;
  token0: string;
  token1: string;
  token0Symbol?: string;
  token1Symbol?: string;

  // All events for this position, sorted by time
  events: PositionEvent[];

  // Timing information
  firstMintTimestamp?: number; // Timestamp of first mint/add liquidity
  lastCollectTimestamp?: number; // Timestamp of last collect/burn
  holdingDurationSeconds?: number; // Duration in seconds

  // Aggregated amounts
  // Mint inputs (from POOL_MINT and ADD_LIQUIDITY)
  mintToken0Amount: bigint;
  mintToken1Amount: bigint;

  // Withdraw outputs (from POOL_BURN and REMOVE_LIQUIDITY)
  withdrawToken0Amount: bigint;
  withdrawToken1Amount: bigint;

  // Fees collected (from POOL_COLLECT)
  feesToken0Amount: bigint;
  feesToken1Amount: bigint;

  // Net LP token changes (excluding fees)
  netLpToken0Change: bigint;
  netLpToken1Change: bigint;

  // Formatted amounts
  formatted?: {
    mintToken0: string;
    mintToken1: string;
    withdrawToken0: string;
    withdrawToken1: string;
    feesToken0: string;
    feesToken1: string;
    netLpToken0Change: string;
    netLpToken1Change: string;
    holdingDuration?: string; // Human-readable duration
  };
}

/**
 * Summary of all position trackings across multiple transactions
 */
export interface PositionTrackingSummary {
  positions: Map<string, PositionTracking>;
}

/**
 * A single supply-withdraw cycle
 */
export interface LendingCycle {
  supplyEvent: PositionEvent;
  withdrawEvents: PositionEvent[]; // One supply can have multiple partial withdraws
  supplyAmount: bigint;
  withdrawnAmount: bigint;
  profit: bigint; // withdrawnAmount - supplyAmount
  holdingDurationSeconds?: number;
  formatted?: {
    supplyAmount: string;
    withdrawnAmount: string;
    profit: string;
    holdingDuration?: string;
  };
}

/**
 * Lending position tracking for AAVE/Euler deposits
 */
export interface LendingPositionTracking {
  token: string;
  tokenSymbol?: string;
  protocol: Protocol;
  vaultAddress?: string; // For Euler, the vault contract address

  // All events for this lending position, sorted by time
  events: PositionEvent[];

  // Supply-withdraw cycles
  cycles: LendingCycle[];

  // Timing information
  firstSupplyTimestamp?: number;
  lastWithdrawTimestamp?: number;
  holdingDurationSeconds?: number;

  // Aggregated amounts
  totalSupplied: bigint; // Total deposited
  totalWithdrawn: bigint; // Total withdrawn (principal + interest)
  totalInterestEarned: bigint; // Interest earned (withdrawn - supplied)

  // Formatted amounts
  formatted?: {
    totalSupplied: string;
    totalWithdrawn: string;
    totalInterestEarned: string;
    holdingDuration?: string;
  };
}

/**
 * Summary of all lending position trackings
 */
export interface LendingPositionSummary {
  positions: Map<string, LendingPositionTracking>; // Key: protocol_token
}
