import { RebalancePlan, RebalanceOpportunity, CurrentPosition, RebalanceCostEstimate } from '../agent/agent.types';

export interface ExecutionStep {
  id: string;
  content: string;
  status: 'success' | 'pending' | 'error';
  metadata?: {
    reason?: string;
    txHash?: string;
    [key: string]: any;
  };
}

export interface ExecutionResult {
  title: string;
  summary: string;
  steps: ExecutionStep[];
  messageType: 'timeline' | 'simple';
}

export function convertPlanToSteps(
  plan: RebalancePlan,
  execResult?: any,
  jobStatus?: string,
): ExecutionResult {
  const steps: ExecutionStep[] = [];

  const currentPositions: CurrentPosition[] = Array.isArray(plan.currentPositions)
    ? plan.currentPositions
    : [];
  const currentValue = currentPositions.reduce((sum, pos) => sum + toNumber(pos.value), 0);
  const currentAPY = currentValue > 0
    ? currentPositions.reduce((sum, pos) => sum + toNumber(pos.apy) * toNumber(pos.value), 0) / currentValue
    : 0;

  steps.push({
    id: '1',
    content: currentValue > 0
      ? `Current: $${currentValue.toFixed(2)} at ${currentAPY.toFixed(2)}% APY`
      : 'Analyzing current positions',
    status: 'success',
  });

  const opportunities: RebalanceOpportunity[] = Array.isArray(plan.opportunities)
    ? plan.opportunities
    : [];

  if (opportunities.length > 0) {
    const opportunitiesText = opportunities
      .map((opp) => {
        const protocol = opp.protocol || 'Unknown';
        const poolName = getOpportunityName(opp);
        const apy = toNumber(opp.expectedAPY);
        const apyLift = currentAPY > 0 ? apy - currentAPY : 0;

        return `- ${formatProtocolName(protocol)} ${poolName}: **${apy.toFixed(2)}% APY** (${apyLift > 0 ? '+' : ''}${apyLift.toFixed(2)}%)`;
      })
      .join('\n');

    steps.push({
      id: '2',
      content: 'Better yields available',
      status: 'success',
      metadata: { reason: opportunitiesText },
    });
  } else {
    const isNoRebalanceNeeded = jobStatus === 'completed';
    const recommendation = plan.recommendation || '';

    steps.push({
      id: '2',
      content: isNoRebalanceNeeded
        ? 'No better yields found, current allocation is optimal'
        : 'No better opportunities found',
      status: 'success',
      metadata: isNoRebalanceNeeded && recommendation ? { reason: recommendation } : undefined,
    });
  }

  if (opportunities.length > 0) {
    const allocation = opportunities.map((opp) => {
      const type = opp.type || 'unknown';
      const protocol = formatProtocolName(opp.protocol || 'Unknown');
      const poolName = getOpportunityName(opp);
      return `${protocol} ${poolName} ${type === 'lp' ? 'LP' : 'Supply'}`;
    });

    let weightedAPY = 0;
    let totalValue = 0;
    opportunities.forEach((opp) => {
      const value = toNumber(opp.amount ?? opp.targetAmount0 ?? opp.targetAmount1);
      const apy = toNumber(opp.expectedAPY);
      weightedAPY += apy * value;
      totalValue += value;
    });
    if (totalValue > 0) {
      weightedAPY /= totalValue;
    }

    const costEstimate = Array.isArray(plan.costEstimates) && plan.costEstimates.length > 0
      ? plan.costEstimates[0]
      : undefined;
    const gasEstimate = resolveGasEstimate(costEstimate);
    const expectedGain = totalValue * (weightedAPY - currentAPY) / 100 / 365;
    const roi = gasEstimate > 0 ? expectedGain / gasEstimate : 0;

    const executeStatus =
      jobStatus === 'completed' ? 'success' :
      jobStatus === 'failed' ? 'error' :
      jobStatus === 'executing' ? 'pending' :
      'pending';

    steps.push({
      id: '3',
      content: executeStatus === 'success'
        ? `Executed rebalance [${allocation.join(', ')}]`
        : executeStatus === 'error'
          ? `Rebalance failed [${allocation.join(', ')}]`
          : `Executing rebalance [${allocation.join(', ')}]`,
      status: executeStatus,
      metadata: {
        reason: roi > 0
          ? `Targeting **${weightedAPY.toFixed(2)}% APY**, achieving **${roi.toFixed(2)}× ROI** with only **$${gasEstimate.toFixed(5)}** in cost`
          : `Targeting **${weightedAPY.toFixed(2)}% APY**`,
      },
    });
  } else if (jobStatus !== 'completed') {
    steps.push({
      id: '3',
      content: 'No rebalancing needed',
      status: 'success',
      metadata: { reason: plan.recommendation || 'Current position is already optimal' },
    });
  }

  const isNoRebalanceCompleted = jobStatus === 'completed' && opportunities.length === 0;

  if (!isNoRebalanceCompleted) {
    if (execResult) {
      const txHash = execResult.txHash || execResult.transactionHash;
      const success = execResult.success !== false && jobStatus === 'completed';
      const errorMessage = execResult.error || execResult.errorMessage;

      steps.push({
        id: '4',
        content: success ? 'Rebalance completed successfully' : 'Rebalance failed',
        status: success ? 'success' : 'error',
        metadata: txHash ? { txHash } : errorMessage ? { reason: errorMessage } : undefined,
      });
    } else if (jobStatus === 'approved' || jobStatus === 'pending') {
      steps.push({
        id: '4',
        content: 'Awaiting execution approval',
        status: 'pending',
      });
    } else if (jobStatus === 'executing') {
      steps.push({
        id: '4',
        content: 'Executing transactions...',
        status: 'pending',
      });
    }
  }

  const title = generateTitle(jobStatus);
  const summary = generateSummary(plan, execResult, jobStatus, currentAPY);

  return {
    title,
    summary,
    steps,
    messageType: 'timeline',
  };
}

function generateTitle(jobStatus?: string): string {
  switch (jobStatus) {
    case 'completed':
      return 'Automated Portfolio Rebalance';
    case 'failed':
      return 'Rebalance Failed';
    case 'executing':
      return 'Executing Rebalance';
    case 'approved':
      return 'Rebalance Pending Approval';
    case 'simulating':
      return 'Analyzing Portfolio';
    default:
      return 'Portfolio Check';
  }
}

function generateSummary(
  plan: RebalancePlan,
  execResult: any,
  jobStatus?: string,
  currentAPY?: number,
): string {
  const opportunities = Array.isArray(plan.opportunities) ? plan.opportunities : [];

  if (jobStatus === 'completed' && opportunities.length === 0) {
    const apyText = currentAPY && currentAPY > 0 ? ` at ${currentAPY.toFixed(2)}% APY` : '';
    return `Holding steady${apyText}, rebalancing not required.`;
  }

  if (jobStatus === 'completed' && opportunities.length > 0) {
    let weightedAPY = 0;
    let totalValue = 0;
    opportunities.forEach((opp) => {
      const value = toNumber(opp.amount ?? opp.targetAmount0 ?? opp.targetAmount1);
      const apy = toNumber(opp.expectedAPY);
      weightedAPY += apy * value;
      totalValue += value;
    });
    if (totalValue > 0) {
      weightedAPY /= totalValue;
    }

    const apyLift = currentAPY ? weightedAPY - currentAPY : 0;
    const gasEstimate = resolveGasEstimate(Array.isArray(plan.costEstimates) ? plan.costEstimates[0] : undefined);

    return `✓ Rebalanced to **${weightedAPY.toFixed(2)}% APY** (${apyLift > 0 ? '+' : ''}${apyLift.toFixed(2)}%), cost **$${gasEstimate.toFixed(5)}**, smart execution by Owlia.`;
  }

  if (jobStatus === 'failed') {
    const errorMessage = execResult?.error || execResult?.errorMessage || 'Unknown error';
    return `✗ Rebalance failed: ${errorMessage}`;
  }

  if (jobStatus === 'executing') {
    return 'Executing rebalance transactions...';
  }

  if (jobStatus === 'approved') {
    return 'Rebalance plan approved, awaiting execution';
  }

  if (opportunities.length === 0) {
    return '✓ No better opportunities found, portfolio is optimal';
  }

  return 'Analyzing portfolio for better yield opportunities...';
}

function formatProtocolName(protocol: string): string {
  const nameMap: Record<string, string> = {
    aerodromeSlipstream: 'Aerodrome',
    uniswapV3: 'Uniswap V3',
    aave: 'Aave',
    euler: 'Euler',
    venus: 'Venus',
  };
  return nameMap[protocol] || protocol.charAt(0).toUpperCase() + protocol.slice(1);
}

function getOpportunityName(opportunity: RebalanceOpportunity): string {
  if (opportunity.poolName) {
    return opportunity.poolName;
  }
  if (opportunity.token0Symbol && opportunity.token1Symbol) {
    return `${opportunity.token0Symbol}/${opportunity.token1Symbol}`;
  }
  if (opportunity.tokenSymbol) {
    return opportunity.tokenSymbol;
  }
  return opportunity.poolAddress || 'Opportunity';
}

function resolveGasEstimate(costEstimate?: RebalanceCostEstimate): number {
  console.log(`costEstimate`, costEstimate)
  if (!costEstimate) {
    return 0.00035;
  }
  if (typeof costEstimate.netGasUsd === 'number' && costEstimate.netGasUsd > 0) {
    return costEstimate.netGasUsd;
  }
  if (typeof costEstimate.gasEstimate === 'number' && costEstimate.gasEstimate > 0) {
    return costEstimate.gasEstimate;
  }
  return 0.00035;
}

function toNumber(value: any): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

