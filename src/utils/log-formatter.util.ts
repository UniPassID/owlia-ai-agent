/**
 * Utilities for formatting rebalance logs
 */

export interface LogEntry {
  timestamp: string;
  level: 'log' | 'error' | 'warn' | 'debug';
  message: string;
  context?: string;
}

export interface RebalanceLogSession {
  jobId: string;
  deploymentId: string;
  userAddress?: string;
  chainId?: string;
  trigger: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status?: string;
  entries: LogEntry[];
  metadata: any;
}

/**
 * Format log session as human-readable text
 */
export function formatAsText(session: RebalanceLogSession): string {
  const lines: string[] = [];
  const DIVIDER = '='.repeat(80);

  // Header
  lines.push(DIVIDER);
  lines.push('REBALANCE OPERATION LOG');
  lines.push(DIVIDER);
  lines.push(`Job ID:        ${session.jobId}`);
  lines.push(`Deployment ID: ${session.deploymentId}`);
  if (session.userAddress) {
    lines.push(`User Address:  ${session.userAddress}`);
  }
  if (session.chainId) {
    lines.push(`Chain:         ${session.chainId}`);
  }
  lines.push(`Trigger:       ${session.trigger}`);
  lines.push(`Started At:    ${session.startTime.toISOString()}`);
  lines.push(DIVIDER);
  lines.push('');

  // Metadata section (precheck results, strategy, etc.)
  if (session.metadata) {
    if (session.metadata.precheckResult) {
      lines.push('=== STEP 1: PRECHECK RESULTS ===');
      const precheck = session.metadata.precheckResult;
      if (precheck.portfolioApy !== undefined) {
        lines.push(`Portfolio APY:          ${precheck.portfolioApy.toFixed(2)}%`);
      }
      if (precheck.opportunityApy !== undefined) {
        lines.push(`Opportunity APY:        ${precheck.opportunityApy.toFixed(2)}%`);
      }
      if (precheck.differenceBps !== undefined) {
        lines.push(`Difference:             ${precheck.differenceBps.toFixed(2)} bps`);
      }
      if (precheck.totalPortfolioValueUsd !== undefined) {
        lines.push(`Total Portfolio Value:  $${formatCurrency(precheck.totalPortfolioValueUsd)}`);
      }
      if (precheck.gasEstimate !== undefined) {
        lines.push(`Gas Estimate:           $${formatCurrency(precheck.gasEstimate)}`);
      }
      if (precheck.breakEvenTimeHours !== undefined) {
        lines.push(`Break-even Time:        ${precheck.breakEvenTimeHours.toFixed(2)} hours`);
      }
      if (precheck.netGainUsd !== undefined) {
        lines.push(`Net Gain (Annual):      $${formatCurrency(precheck.netGainUsd)}`);
      }
      if (precheck.bestStrategy) {
        lines.push(`Selected Strategy:      ${precheck.bestStrategy.name || 'Unknown'}`);
      }
      lines.push('');
    }
  }

  // Log entries
  lines.push('=== EXECUTION LOG ===');
  for (const entry of session.entries) {
    const timestamp = new Date(entry.timestamp).toISOString().replace('T', ' ').split('.')[0];
    const level = entry.level.toUpperCase().padEnd(5);
    const context = entry.context ? `[${entry.context}]` : '';
    lines.push(`[${timestamp}] ${level} ${context} ${entry.message}`);
  }
  lines.push('');

  // Footer
  lines.push(DIVIDER);
  lines.push('FINAL STATUS');
  lines.push(DIVIDER);
  lines.push(`Status:        ${session.status || 'UNKNOWN'}`);
  if (session.endTime) {
    lines.push(`Completed At:  ${session.endTime.toISOString()}`);
  }
  if (session.duration !== undefined) {
    lines.push(`Total Duration: ${session.duration.toFixed(2)} seconds`);
  }
  lines.push(DIVIDER);

  return lines.join('\n');
}

/**
 * Format log session as structured JSON
 */
export function formatAsJson(session: RebalanceLogSession): string {
  const output = {
    jobId: session.jobId,
    deploymentId: session.deploymentId,
    userAddress: session.userAddress,
    chainId: session.chainId,
    trigger: session.trigger,
    startTime: session.startTime.toISOString(),
    endTime: session.endTime?.toISOString(),
    duration: session.duration,
    status: session.status,
    metadata: session.metadata,
    logs: session.entries,
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Format timestamp as readable string
 */
export function formatTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').split('.')[0];
}

/**
 * Format currency amount
 */
export function formatCurrency(amount: number): string {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Mask address for privacy (optional)
 */
export function maskAddress(address: string, showChars: number = 6): string {
  if (!address || address.length <= showChars * 2) {
    return address;
  }
  return `${address.slice(0, showChars)}...${address.slice(-showChars)}`;
}

/**
 * Generate log file name
 */
export function generateLogFileName(
  userId: string,
  jobId: string,
  extension: 'log' | 'json',
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T').join('_').split('Z')[0];
  return `user-${userId}-job-${jobId}-${timestamp}.${extension}`;
}

/**
 * Get date-based subdirectory (YYYY-MM-DD)
 */
export function getDateSubdirectory(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
