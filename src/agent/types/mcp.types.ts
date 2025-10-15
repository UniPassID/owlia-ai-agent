export enum ChainId {
  ETHEREUM = "1",
  BSC = "56",
  POLYGON = "137",
  ARBITRUM = "42161",
  OPTIMISM = "10",
  BASE = "8453",
}

// Improved Account Manager Requests
export interface GetIdleAssetsRequest {
  wallet_address: string;
  chain_id: ChainId;
}


export interface GetActiveInvestmentsRequest {
  wallet_address: string;
  chain_id: ChainId;
}

// Market Data Requests
export interface GetUniswapPoolRequest {
  chain_id: ChainId;
  // pool_address: string;
  // token_pairs?: string[];
  // fee_tiers?: (500 | 3000 | 10000)[];
  // min_tvl?: number;
}

// Supply Opportunities Request
export interface GetSupplyOpportunitiesRequest {
  chain_id: ChainId;
  amount: number; // User's fund amount in USD
  protocols?: string[]; // Optional: limit to specific protocols
  min_apy?: number; // Optional: minimum APY filter (percentage)
  min_total_supply?: number; // Optional: minimum total supply filter (USD)
}



export interface IdleAssetsResponse {
  account: string;
  idleAssetsUsd: string;
  deploymentRate: string;
  assets: IdleAsset[];
}

export interface IdleAsset {
  tokenAddress: string;
  tokenSymbol: string;
  balance: string;
  balanceUsd: string;
  tokenPriceUsd: string;
}


export interface ActiveInvestmentsResponse {
  activeInvestmentsUsd: string;
  performanceSummary: PerformanceSummary;
  uniswapV3LiquidityInvestments: LiquidityInvestmentsSummary | null;
  aerodromeSlipstreamLiquidityInvestments: LiquidityInvestmentsSummary | null;
  lendingInvestments: LendingInvestmentsSummary | null;
  riskMetrics: RiskMetrics;
}

export interface PerformanceSummary {
  weightedApy: string;
  totalYieldUsd: string;
  riskLevel: "low" | "medium" | "high";
}

export interface LiquidityInvestmentsSummary {
  totalValueUsd: string;
  totalDeployedUsd: string;
  pendingRewardsUsd: string;
  avgApy: string;
  activePositions: number;
  positions: AccountLiquidityPosition[]; // Reuse existing type
}

export interface LendingInvestmentsSummary {
  netWorthUsd: string;
  totalSuppliedUsd: string;
  totalBorrowedUsd: string;
  netApy: string;
  healthFactorMin: string;
  leverageRatio: string;
  positions: AccountLendingPosition[]; // Reuse existing type
}

export interface RiskMetrics {
  concentrationRisk: "low" | "medium" | "high";
  liquidationRisk: "low" | "medium" | "high";
  protocolDiversification: "low" | "medium" | "high";
}


export type AccountLendingPosition = {
  protocol: "aaveV3" | "venusV4" | "eulerV2";
  accountId: string | null;
  protocolPositions: AccountLendingProtocolPosition;
};

export type AccountLendingProtocolPosition = {
  supplies: AccountLendingSupply[];
  borrows: AccountLendingBorrow[];
  totalSupplyUsd: string;
  totalBorrowUsd: string;
  totalNetWorthUsd: string;
  totalApy: string;
  ltv: string;
  liquidationThreshold: string;
  healthFactor: string;
};




export type AccountLendingSupply = {
  tokenSymbol: string;
  tokenAddress: string;
  vTokenAddress?: string | null;
  supplyAmount: string;
  supplyAmountUsd: string;
  supplyApy: string;
};

export type AccountLendingBorrow = {
  tokenSymbol: string;
  tokenAddress: string;
  borrowAmount: string;
  borrowAmountUsd: string;
  borrowApy: string;
};



export type AccountLiquidityPosition = {
  protocol: "uniswapV3" | "aerodromeSlipstream";
  protocolPositions: AccountLiquidityProtocolPosition[];
};

export type AccountLiquidityProtocolPosition = {
  poolInfo: {
    poolAddress: string;
    tokens: {
      address: string;
      symbol: string;
    }[];
    fee?: string;
  };
  totalNetWorthUsd: string;
  apy?: string;
  deposits: AccountLiquidityDeposit[];
};

export type AccountLiquidityDeposit = {
  positionApy?: string;
  depositedAmountUsd: string;
  unclaimedRewardsAmountUsd?: string;
  extraData: AccountLiquidityUniswapV3ExtraData;
};

export type AccountLiquidityUniswapV3ExtraData = {
  tokenId?: string;
  tick?: string;
  tickLower: string;
  tickUpper: string;
  token0: string;
  token1: string;
  token0Amount: string;
  token1Amount: string;
  token0AmountUsd: string;
  token1AmountUsd: string;
  unclaimedRewardToken0Amount?: string;
  unclaimedRewardToken1Amount?: string;
  unclaimedRewardToken0AmountUsd?: string;
  unclaimedRewardToken1AmountUsd?: string;
};


// Supply Opportunities Response
export interface GetSupplyOpportunitiesResponse {
  opportunities: SupplyOpportunity[];
  summary: {
    total_opportunities: number;
    average_apy_before: number;
    average_apy_after: number;
    best_opportunity: SupplyOpportunity | null;
    input_amount: number;
  };
}

export interface SupplyOpportunity {
  protocol: "aave" | "euler" | "venus";
  asset: string;
  vault_address?: string;
  
  before: {
    supplyAPY: number;
    totalSupplyUSD: number;
    utilization: number;
  };
  
  after: {
    supplyAPY: number;
    totalSupplyUSD: number;
    utilization: number;
  };
  
  changes: {
    apyDelta: number;
    apyDeltaPercent: number;
    expectedAnnualReturn: number;
  };
}


// LP Simulation Requests
export interface GetLpSimulateRequest {
  chain_id: ChainId;
  poolOperation?: {
    poolAddress: string; // Pool address (e.g., Uniswap V3 pool)
    operation: "add" | "remove"; // Add or remove liquidity
    amountUSD: number; // Amount in USD
    tickLower?: number; // Lower tick for concentrated liquidity (optional)
    tickUpper?: number; // Upper tick for concentrated liquidity (optional)
    timeHorizon?: number; // Time horizon in minutes for APY calculation (default: 60)
  };
  priceImpact?: boolean; // Calculate price impact (default: true)
  includeIL?: boolean; // Include impermanent loss calculation (default: true)
}




// LP Simulation Response
export interface GetLpSimulateResponse {
  timestamp: number;
  summary: {
    totalLiquidityUSD: number;          // Total liquidity added/removed
    totalExpectedAPY: number;            // Weighted average expected APY
    totalExpectedDailyReturn: number;   // Total expected daily return in USD
    requiredTokens?: {                  // Required token amounts for the position
      token0: {
        amount: number;                  // Token0 amount needed
        amountUSD: number;               // Token0 value in USD
        percentage: number;              // Percentage of total investment
      };
      token1: {
        amount: number;                  // Token1 amount needed
        amountUSD: number;               // Token1 value in USD
        percentage: number;              // Percentage of total investment
      };
    };
  };
  pool: {
    poolAddress: string;                // Pool contract address
    inputAmountUSD: number;             // Amount added/removed in USD

    position: {
      tickLower?: number;                // Lower tick (for concentrated liquidity)
      tickUpper?: number;                // Upper tick (for concentrated liquidity)
      currentTick: number;               // Current pool tick
      inRange: boolean;                  // Whether position is in range
      priceRange?: {
        lower: number;                   // Lower price bound
        upper: number;                   // Upper price bound
        current: number;                 // Current price
      };
      token0Amount: number;
      token1Amount: number;
    };
    
    before: {
      totalLiquidityUSD: number;         // Total pool liquidity before
      apy: number;                       // Current APY
      tvl: number;                       // Total value locked
    };
    
    after: {
      totalLiquidityUSD: number;         // Total pool liquidity after
      estimatedAPY: number;              // Estimated APY after operation
      tvl: number;                       // New TVL
      yourShare: number;                 // Your % share of the pool
    };
    
  };
}