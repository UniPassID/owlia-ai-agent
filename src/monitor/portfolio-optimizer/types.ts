/**
 * Portfolio Optimizer Types
 * Contains all type definitions for the marginal optimization algorithm
 */

export interface Opportunity {
  id: string;
  type: 'supply' | 'lp';
  targetTokens: string[];
  getAPY: (amount: number) => number;
  getAPYAsync?: (amount: number) => Promise<number>;
  maxAmount: number;
  protocol: string;
  chainId?: string;
  currentTick?: number;
  // For supply opportunities
  asset?: string;
  vaultAddress?: string;
  // For LP opportunities
  poolAddress?: string;
  token0Address?: string;
  token1Address?: string;
  tickLower?: number;
  tickUpper?: number;
}

export interface MarginalScore {
  opp: Opportunity;
  netAPY: number;
  breakevenHours: number;
  amount: number;
  swapCost: number;
  grossAPY: number;
}

export interface AllocationResult {
  positions: Array<{
    opportunity: Opportunity;
    amount: number;
    apy: number;
  }>;
  totalInvested: number;
  weightedAPY: number;
  allocationHistory: Array<{
    oppId: string;
    amount: number;
    netAPY: number;
    totalAllocated: number;
    swapCost?: number;
  }>;
  totalSwapCost: number;
}

export interface OptimizationOptions {
  incrementSize: number;
  minMarginalAPY: number;
  maxBreakevenHours: number;
  holdingPeriodDays: number;
}

export interface APYFunctions {
  syncFn: (amount: number) => number;
  asyncFn: (amount: number) => Promise<number>;
}

/**
 * Holdings state during portfolio optimization
 * Tracks initial holdings, used amounts, and which tokens have been swapped
 */
export interface HoldingsState {
  /** Initial token holdings at start of optimization */
  currentHoldings: Record<string, number>;
  /** Amount of each token already allocated to opportunities */
  usedHoldings: Record<string, number>;
  /** Tokens that have been swapped to (for gas fee tracking) */
  swappedTokens: Set<string>;
}
