export interface AgentContext {
  userId: string;
  userAddress: string;
  jobId: string;
  userPolicy?: {
    chains: string[];
    assetWhitelist: string[];
    minAprLiftBps: number;
    minNetUsd: number;
    minHealthFactor: number;
    maxSlippageBps: number;
    maxGasUsd: number;
    maxPerTradeUsd: number;
  };
  trigger: string;
}

import { Step1SummaryData, Step2SummaryData } from './analysis.prompt';

export interface AgentResult {
  success: boolean;
  action: 'analyzed' | 'planned' | 'simulated' | 'executed' | 'rejected';
  data?: AgentResultData | null;
  error?: string;
  reasoning?: string;
}

export type SupplyProtocol = 'aave' | 'euler' | 'venus';
export type LiquidityProtocol = 'uniswapV3' | 'aerodromeSlipstream';

export interface RebalanceOpportunity {
  type?: 'lp' | 'supply';
  protocol: SupplyProtocol | LiquidityProtocol | string;
  poolName?: string;
  poolAddress?: string;
  token0Address?: string;
  token0Symbol?: string;
  token1Address?: string;
  token1Symbol?: string;
  targetTickLower?: number;
  targetTickUpper?: number;
  targetAmount0?: number;
  targetAmount1?: number;
  tokenAddress?: string;
  tokenSymbol?: string;
  vToken?: string;
  amount?: number;
  expectedAPY?: number;
  currentAPY?: number;
  [key: string]: any;
}

export interface CurrentPosition {
  type?: 'lp' | 'supply' | 'idle';
  protocol?: string;
  poolAddress?: string;
  tokenAddress?: string;
  amount?: number;
  value?: number;
  apy?: number;
  [key: string]: any;
}

export interface RebalanceCostEstimate {
  strategyId?: string;
  name?: string;
  gasEstimate?: number;
  netGasUsd?: number;
  breakEvenTime?: string;
  [key: string]: any;
}

export interface RebalancePlan {
  description?: string;
  recommendation?: string;
  hasOpportunity?: boolean;
  shouldRebalance?: boolean;
  opportunities: RebalanceOpportunity[];
  currentPositions: CurrentPosition[];
  chainId: string;
  userAddress: string;
  costEstimates?: RebalanceCostEstimate[];
  [key: string]: any;
}

export interface RebalanceAnalysisData {
  simulation: any;
  plan: RebalancePlan | null;
  reasoning?: string;
  analysis?: any;
  currentStrategy?: any;
  shouldRebalance?: boolean;
  toolResults: any[];
  step1Summary?: Step1SummaryData;
  step2Summary?: Step2SummaryData;
}


export type AgentResultData = RebalanceAnalysisData 
