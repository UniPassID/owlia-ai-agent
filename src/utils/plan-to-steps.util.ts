/**
 * Utility to convert plan data to user-friendly execution steps
 */

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

/**
 * Convert plan and execution result to display steps
 */
export function convertPlanToSteps(
  plan: any,
  execResult?: any,
  jobStatus?: string,
): ExecutionResult {
  const steps: ExecutionStep[] = [];

  // Step 1: Current position analysis
  const currentPositions = plan?.currentPositions || [];
  let currentValue = 0;
  let currentAPY = 0;

  if (currentPositions.length > 0) {
    currentPositions.forEach((pos: any) => {
      if (pos.value) currentValue += pos.value;
      if (pos.apy) currentAPY += pos.apy * (pos.value || 0);
    });
    if (currentValue > 0) {
      currentAPY = currentAPY / currentValue;
    }
  }

  steps.push({
    id: '1',
    content: currentValue > 0
      ? `Current: $${currentValue.toFixed(2)} at ${currentAPY.toFixed(2)}% APY`
      : 'Analyzing current positions',
    status: 'success',
  });

  // Step 2: Better yields available
  const opportunities = plan?.opportunities || [];

  if (opportunities.length > 0) {
    const opportunitiesText = opportunities
      .map((opp: any) => {
        const protocol = opp.protocol || 'Unknown';
        const poolName = opp.poolName || `${opp.token0Symbol}/${opp.token1Symbol}` || opp.tokenSymbol || '';
        const apy = opp.expectedAPY || 0;
        const apyLift = currentAPY > 0 ? apy - currentAPY : 0;

        return `- ${formatProtocolName(protocol)} ${poolName}: **${apy.toFixed(2)}% APY** (${apyLift > 0 ? '+' : ''}${apyLift.toFixed(2)}%)`;
      })
      .join('\n');

    steps.push({
      id: '2',
      content: 'Better yields available',
      status: 'success',
      metadata: {
        reason: opportunitiesText,
      },
    });
  } else {
    // Check if this is a "no rebalancing needed" scenario (completed job with no opportunities)
    const isNoRebalanceNeeded = jobStatus === 'completed' && opportunities.length === 0;
    const recommendation = plan?.recommendation || '';

    steps.push({
      id: '2',
      content: isNoRebalanceNeeded
        ? 'No better yields found, current allocation is optimal'
        : 'No better opportunities found',
      status: 'success',
      metadata: isNoRebalanceNeeded && recommendation ? {
        reason: recommendation,
      } : undefined,
    });
  }

  // Step 3: Executing rebalance
  if (opportunities.length > 0) {
    // Calculate allocation strategy
    const allocation = opportunities.map((opp: any) => {
      const type = opp.type || 'unknown';
      const protocol = formatProtocolName(opp.protocol || 'Unknown');
      const poolName = opp.poolName || `${opp.token0Symbol}/${opp.token1Symbol}` || opp.tokenSymbol || '';
      return `${protocol} ${poolName} ${type === 'lp' ? 'LP' : 'Supply'}`;
    });

    // Calculate weighted APY
    let weightedAPY = 0;
    let totalValue = 0;
    opportunities.forEach((opp: any) => {
      const value = parseFloat(opp.amount || opp.targetAmount0 || '0');
      const apy = opp.expectedAPY || 0;
      weightedAPY += apy * value;
      totalValue += value;
    });
    if (totalValue > 0) {
      weightedAPY = weightedAPY / totalValue;
    }

    // Calculate ROI (simplified)
    const gasEstimate = plan?.gasEstimate || 0.00035;
    const expectedGain = totalValue * (weightedAPY - currentAPY) / 100 / 365; // Daily gain
    const roi = gasEstimate > 0 ? expectedGain / gasEstimate : 0;

    const allocationText = allocation.join(', ');

    const executeStatus =
      jobStatus === 'completed' ? 'success' :
      jobStatus === 'failed' ? 'error' :
      jobStatus === 'executing' ? 'pending' :
      'pending';

    steps.push({
      id: '3',
      content: executeStatus === 'success'
        ? `Executed rebalance [${allocationText}]`
        : executeStatus === 'error'
        ? `Rebalance failed [${allocationText}]`
        : `Executing rebalance [${allocationText}]`,
      status: executeStatus,
      metadata: {
        reason: roi > 0
          ? `Targeting **${weightedAPY.toFixed(2)}% APY**, achieving **${roi.toFixed(0)}× ROI** with only **$${gasEstimate.toFixed(5)}** in cost`
          : `Targeting **${weightedAPY.toFixed(2)}% APY**`,
      },
    });
  } else {
    // Don't add step 3 if this is a "no rebalancing needed" completed job
    // Step 2 already covers this case
    if (jobStatus !== 'completed') {
      steps.push({
        id: '3',
        content: 'No rebalancing needed',
        status: 'success',
        metadata: {
          reason: plan?.recommendation || 'Current position is already optimal',
        },
      });
    }
  }

  // Step 4: Completion status
  // Skip step 4 for "no rebalancing needed" completed jobs (only 2 steps needed)
  const isNoRebalanceCompleted = jobStatus === 'completed' && opportunities.length === 0;

  if (!isNoRebalanceCompleted) {
    if (execResult) {
      const txHash = execResult.txHash || execResult.transactionHash;
      const success = execResult.success !== false && jobStatus === 'completed';
      const errorMessage = execResult.error || execResult.errorMessage;

      steps.push({
        id: '4',
        content: success
          ? 'Rebalance completed successfully'
          : 'Rebalance failed',
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

  // Generate title and summary
  const title = generateTitle(jobStatus);
  const summary = generateSummary(plan, execResult, jobStatus, currentAPY);

  return {
    title,
    summary,
    steps,
    messageType: 'timeline',
  };
}

/**
 * Generate title based on job status
 */
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

/**
 * Generate summary based on plan and execution result
 */
function generateSummary(
  plan: any,
  execResult: any,
  jobStatus?: string,
  currentAPY?: number,
): string {
  const opportunities = plan?.opportunities || [];

  // Handle "no rebalancing needed" completed jobs
  if (jobStatus === 'completed' && opportunities.length === 0) {
    const apyText = currentAPY > 0 ? ` at ${currentAPY.toFixed(2)}% APY` : '';
    return `Holding steady${apyText}, rebalancing not required.`;
  }

  if (jobStatus === 'completed' && opportunities.length > 0) {
    // Calculate weighted target APY
    let weightedAPY = 0;
    let totalValue = 0;
    opportunities.forEach((opp: any) => {
      const value = parseFloat(opp.amount || opp.targetAmount0 || '0');
      const apy = opp.expectedAPY || 0;
      weightedAPY += apy * value;
      totalValue += value;
    });
    if (totalValue > 0) {
      weightedAPY = weightedAPY / totalValue;
    }

    const apyLift = currentAPY ? weightedAPY - currentAPY : 0;
    const gasEstimate = plan?.gasEstimate || 0.00035;

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

/**
 * Format protocol name for display
 */
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
