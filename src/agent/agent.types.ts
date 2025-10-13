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

export interface AgentResult {
  success: boolean;
  action: 'analyzed' | 'planned' | 'simulated' | 'executed' | 'rejected';
  data?: any;
  error?: string;
  reasoning?: string;
}
