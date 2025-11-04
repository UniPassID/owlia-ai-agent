import { ethers } from 'ethers';
import { lookupTokenSymbol, lookupTokenDecimals } from '../agent/token-utils';
import {
  RebalanceAction,
  RebalanceActionType,
  Protocol,
  ParsedTransaction,
  PositionTracking,
  PositionTrackingSummary,
  LendingPositionTracking,
  LendingPositionSummary,
  PositionEvent,
  LendingCycle,
} from './types/transaction-parser.types';

/**
 * Position tracking utility functions for analyzing LP and lending positions
 * across multiple transactions
 */

/**
 * Get token symbol and decimals from token-utils
 */
function getTokenInfo(tokenAddress: string, chainId: string): { symbol?: string; decimals?: number } {
  const symbol = lookupTokenSymbol(tokenAddress, chainId);
  const decimals = symbol ? lookupTokenDecimals(symbol, chainId) : null;

  return {
    symbol: symbol || undefined,
    decimals: decimals || undefined,
  };
}

/**
 * Format amount with decimals
 */
function formatAmount(amount: string, decimals?: number): string | undefined {
  if (!decimals) return undefined;
  try {
    return ethers.formatUnits(amount, decimals);
  } catch {
    return undefined;
  }
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Get emoji for action type
 */
function getActionEmoji(type: RebalanceActionType): string {
  switch (type) {
    case RebalanceActionType.POOL_MINT:
    case RebalanceActionType.ADD_LIQUIDITY:
      return '➕';
    case RebalanceActionType.POOL_BURN:
    case RebalanceActionType.REMOVE_LIQUIDITY:
      return '➖';
    case RebalanceActionType.POOL_COLLECT:
      return '💰';
    default:
      return '•';
  }
}

/**
 * Get emoji for lending action type
 */
function getLendingActionEmoji(type: RebalanceActionType): string {
  switch (type) {
    case RebalanceActionType.SUPPLY:
      return '💵';
    case RebalanceActionType.WITHDRAW:
      return '💸';
    default:
      return '•';
  }
}

/**
 * Track position flows by tokenId across multiple transactions
 * Analyzes all actions across all transactions to calculate inflows, outflows, and fees for each position
 * @param parsedTransactions Array of parsed transactions with their metadata
 * @param chainId Chain ID for token info lookup
 */
export function trackPositionFlows(
  parsedTransactions: Array<{ txHash: string; parsed: ParsedTransaction }>,
  chainId: string = '8453',
): PositionTrackingSummary {
  const positions = new Map<string, PositionTracking>();

  // Collect all position events from all transactions
  for (const { txHash, parsed } of parsedTransactions) {
    // In each transaction, map POOL_BURN/POOL_MINT/POOL_COLLECT to their corresponding tokenId
    // by finding the adjacent IncreaseLiquidity/DecreaseLiquidity events
    const actionsWithContext: Array<{ action: RebalanceAction; inferredTokenId?: string }> = [];

    for (let i = 0; i < parsed.actions.length; i++) {
      const action = parsed.actions[i];
      let inferredTokenId: string | undefined;

      // If this is a POOL_BURN, look for the next REMOVE_LIQUIDITY event
      if (action.protocol === Protocol.UNISWAP_V3 && action.type === RebalanceActionType.POOL_BURN) {
        // Find the next REMOVE_LIQUIDITY action in the same transaction
        for (let j = i + 1; j < parsed.actions.length; j++) {
          const nextAction = parsed.actions[j];
          if (
            nextAction.protocol === Protocol.UNISWAP_V3 &&
            nextAction.type === RebalanceActionType.REMOVE_LIQUIDITY &&
            nextAction.tokenId
          ) {
            inferredTokenId = nextAction.tokenId;
            break;
          }
        }
      }

      // If this is a POOL_COLLECT, look for the nearest REMOVE_LIQUIDITY event (before or after)
      if (action.protocol === Protocol.UNISWAP_V3 && action.type === RebalanceActionType.POOL_COLLECT) {
        // First try to find REMOVE_LIQUIDITY before this event
        for (let j = i - 1; j >= 0; j--) {
          const prevAction = parsed.actions[j];
          if (
            prevAction.protocol === Protocol.UNISWAP_V3 &&
            prevAction.type === RebalanceActionType.REMOVE_LIQUIDITY &&
            prevAction.tokenId
          ) {
            inferredTokenId = prevAction.tokenId;
            break;
          }
        }

        // If not found before, try to find REMOVE_LIQUIDITY after this event
        if (!inferredTokenId) {
          for (let j = i + 1; j < parsed.actions.length; j++) {
            const nextAction = parsed.actions[j];
            if (
              nextAction.protocol === Protocol.UNISWAP_V3 &&
              nextAction.type === RebalanceActionType.REMOVE_LIQUIDITY &&
              nextAction.tokenId
            ) {
              inferredTokenId = nextAction.tokenId;
              break;
            }
          }
        }
      }

      // If this is a POOL_MINT, look for the next ADD_LIQUIDITY event
      if (action.protocol === Protocol.UNISWAP_V3 && action.type === RebalanceActionType.POOL_MINT) {
        // Find the next ADD_LIQUIDITY action in the same transaction
        for (let j = i + 1; j < parsed.actions.length; j++) {
          const nextAction = parsed.actions[j];
          if (
            nextAction.protocol === Protocol.UNISWAP_V3 &&
            nextAction.type === RebalanceActionType.ADD_LIQUIDITY &&
            nextAction.tokenId
          ) {
            inferredTokenId = nextAction.tokenId;
            break;
          }
        }
      }

      actionsWithContext.push({ action, inferredTokenId });
    }

    for (const { action, inferredTokenId } of actionsWithContext) {
      // Use explicit tokenId or inferred tokenId
      const tokenId = action.tokenId || inferredTokenId;

      // Only track Uniswap V3 position-related actions with tokenId
      if (!tokenId || action.protocol !== Protocol.UNISWAP_V3) {
        continue;
      }

      // Initialize position if not exists
      if (!positions.has(tokenId)) {
        const token0 = action.tokens[0]?.token || 'UNKNOWN_TOKEN0';
        const token1 = action.tokens[1]?.token || 'UNKNOWN_TOKEN1';

        positions.set(tokenId, {
          tokenId,
          token0,
          token1,
          token0Symbol: action.tokens[0]?.symbol,
          token1Symbol: action.tokens[1]?.symbol,
          events: [],
          mintToken0Amount: 0n,
          mintToken1Amount: 0n,
          withdrawToken0Amount: 0n,
          withdrawToken1Amount: 0n,
          feesToken0Amount: 0n,
          feesToken1Amount: 0n,
          netLpToken0Change: 0n,
          netLpToken1Change: 0n,
        });
      }

      const position = positions.get(tokenId)!;
      const amount0 = BigInt(action.tokens[0]?.amount || '0');
      const amount1 = BigInt(action.tokens[1]?.amount || '0');

      // Add event to position
      position.events.push({
        txHash,
        timestamp: parsed.timestamp,
        blockNumber: parsed.blockNumber,
        eventIndex: action.eventIndex,
        logIndex: action.logIndex,
        type: action.type,
        token0: action.tokens[0]?.token || 'UNKNOWN_TOKEN0',
        token1: action.tokens[1]?.token || 'UNKNOWN_TOKEN1',
        token0Amount: amount0,
        token1Amount: amount1,
        token0Symbol: action.tokens[0]?.symbol,
        token1Symbol: action.tokens[1]?.symbol,
      });

      // Update position based on action type
      switch (action.type) {
        case RebalanceActionType.POOL_MINT:
        case RebalanceActionType.ADD_LIQUIDITY:
          // Mint/Add = tokens coming in (principal)
          position.mintToken0Amount += amount0;
          position.mintToken1Amount += amount1;
          position.netLpToken0Change += amount0;
          position.netLpToken1Change += amount1;
          break;

        case RebalanceActionType.POOL_BURN:
        case RebalanceActionType.REMOVE_LIQUIDITY:
          // Burn = reduce liquidity, amounts represent principal being removed
          // We don't update withdraw here, will be updated in Collect
          // Just track the net LP change (negative because we're removing liquidity)
          position.netLpToken0Change -= amount0;
          position.netLpToken1Change -= amount1;
          break;

        case RebalanceActionType.POOL_COLLECT:
          // Collect = actual withdrawal (principal + fees)
          // The total amount collected
          position.withdrawToken0Amount += amount0;
          position.withdrawToken1Amount += amount1;
          break;
      }
    }
  }

  // Sort events by time and calculate fees for all positions
  for (const position of positions.values()) {
    // Sort events chronologically
    position.events.sort((a, b) => {
      if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }
      if (a.logIndex !== b.logIndex) {
        return a.logIndex - b.logIndex;
      }
      return a.eventIndex - b.eventIndex;
    });

    // Calculate fees and timing: for each Collect event, find the preceding Burn event
    // Fees = Collect amount - Burn amount
    let lastBurnToken0 = 0n;
    let lastBurnToken1 = 0n;

    for (const event of position.events) {
      // Track first mint timestamp
      if (
        !position.firstMintTimestamp &&
        (event.type === RebalanceActionType.POOL_MINT || event.type === RebalanceActionType.ADD_LIQUIDITY)
      ) {
        position.firstMintTimestamp = event.timestamp;
      }

      // Track last collect/burn timestamp
      if (
        event.type === RebalanceActionType.POOL_COLLECT ||
        event.type === RebalanceActionType.POOL_BURN ||
        event.type === RebalanceActionType.REMOVE_LIQUIDITY
      ) {
        if (event.timestamp) {
          if (!position.lastCollectTimestamp || event.timestamp > position.lastCollectTimestamp) {
            position.lastCollectTimestamp = event.timestamp;
          }
        }
      }

      if (event.type === RebalanceActionType.POOL_BURN) {
        // Record the burn amounts (principal being removed)
        lastBurnToken0 = event.token0Amount;
        lastBurnToken1 = event.token1Amount;
      } else if (event.type === RebalanceActionType.POOL_COLLECT) {
        // Collect = principal + fees
        // Calculate fees if we have a preceding burn
        if (lastBurnToken0 > 0n || lastBurnToken1 > 0n) {
          const feesToken0 = event.token0Amount - lastBurnToken0;
          const feesToken1 = event.token1Amount - lastBurnToken1;

          position.feesToken0Amount += feesToken0;
          position.feesToken1Amount += feesToken1;

          // Reset burn amounts after calculating fees
          lastBurnToken0 = 0n;
          lastBurnToken1 = 0n;
        } else {
          // If no preceding burn, all collected amount is fees (e.g., just collecting fees without burning)
          position.feesToken0Amount += event.token0Amount;
          position.feesToken1Amount += event.token1Amount;
        }
      }
    }

    // Calculate holding duration
    if (position.firstMintTimestamp && position.lastCollectTimestamp) {
      position.holdingDurationSeconds = position.lastCollectTimestamp - position.firstMintTimestamp;
    }

    const token0Info = getTokenInfo(position.token0, chainId);
    const token1Info = getTokenInfo(position.token1, chainId);

    // Update symbols if found
    if (token0Info.symbol) position.token0Symbol = token0Info.symbol;
    if (token1Info.symbol) position.token1Symbol = token1Info.symbol;

    position.formatted = {
      mintToken0:
        formatAmount(position.mintToken0Amount.toString(), token0Info.decimals) ||
        position.mintToken0Amount.toString(),
      mintToken1:
        formatAmount(position.mintToken1Amount.toString(), token1Info.decimals) ||
        position.mintToken1Amount.toString(),
      withdrawToken0:
        formatAmount(position.withdrawToken0Amount.toString(), token0Info.decimals) ||
        position.withdrawToken0Amount.toString(),
      withdrawToken1:
        formatAmount(position.withdrawToken1Amount.toString(), token1Info.decimals) ||
        position.withdrawToken1Amount.toString(),
      feesToken0:
        formatAmount(position.feesToken0Amount.toString(), token0Info.decimals) ||
        position.feesToken0Amount.toString(),
      feesToken1:
        formatAmount(position.feesToken1Amount.toString(), token1Info.decimals) ||
        position.feesToken1Amount.toString(),
      netLpToken0Change:
        formatAmount(position.netLpToken0Change.toString(), token0Info.decimals) ||
        position.netLpToken0Change.toString(),
      netLpToken1Change:
        formatAmount(position.netLpToken1Change.toString(), token1Info.decimals) ||
        position.netLpToken1Change.toString(),
      holdingDuration: position.holdingDurationSeconds ? formatDuration(position.holdingDurationSeconds) : undefined,
    };
  }

  return { positions };
}

/**
 * Format position tracking summary as human-readable text
 */
export function formatPositionTracking(summary: PositionTrackingSummary, chainId: string = '8453'): string {
  const lines: string[] = [];

  if (summary.positions.size === 0) {
    return 'No position tracking data available (no tokenId found in actions)';
  }

  lines.push(`\nPosition Tracking Summary (${summary.positions.size} positions):`);
  lines.push('='.repeat(80));

  for (const position of summary.positions.values()) {
    lines.push(`\nTokenId: ${position.tokenId}`);
    lines.push(`Tokens: ${position.token0Symbol || position.token0} / ${position.token1Symbol || position.token1}`);
    lines.push(`Total Events: ${position.events.length}`);
    lines.push('');

    // Show event timeline
    if (position.events.length > 0) {
      lines.push('  📅 Event Timeline:');
      for (const event of position.events) {
        const timeStr = event.timestamp
          ? new Date(event.timestamp * 1000).toISOString()
          : `Block ${event.blockNumber}`;
        const actionEmoji = getActionEmoji(event.type);
        const token0Info = getTokenInfo(event.token0, chainId);
        const token1Info = getTokenInfo(event.token1, chainId);

        const amount0Formatted =
          formatAmount(event.token0Amount.toString(), token0Info.decimals) || event.token0Amount.toString();
        const amount1Formatted =
          formatAmount(event.token1Amount.toString(), token1Info.decimals) || event.token1Amount.toString();

        lines.push(`    ${actionEmoji} ${timeStr}`);
        lines.push(`       ${event.type}`);
        lines.push(`       Tx: ${event.txHash}`);
        lines.push(
          `       ${event.token0Symbol || 'Token0'}: ${amount0Formatted}, ${event.token1Symbol || 'Token1'}: ${amount1Formatted}`,
        );
      }
      lines.push('');
    }

    // Show aggregated summary
    lines.push('  📊 Aggregated Summary:');
    lines.push('');

    // Show holding duration if available
    if (position.formatted?.holdingDuration) {
      lines.push('  ⏱️  Holding Duration:');
      lines.push(`    ${position.formatted.holdingDuration}`);
      if (position.firstMintTimestamp) {
        lines.push(`    From: ${new Date(position.firstMintTimestamp * 1000).toISOString()}`);
      }
      if (position.lastCollectTimestamp) {
        lines.push(`    To: ${new Date(position.lastCollectTimestamp * 1000).toISOString()}`);
      }
      lines.push('');
    }

    lines.push('  📥 Total Minted (Inflows):');
    lines.push(`    ${position.token0Symbol || 'Token0'}: ${position.formatted?.mintToken0}`);
    lines.push(`    ${position.token1Symbol || 'Token1'}: ${position.formatted?.mintToken1}`);
    lines.push('');

    lines.push('  📤 Total Withdrawn (Outflows):');
    lines.push(`    ${position.token0Symbol || 'Token0'}: ${position.formatted?.withdrawToken0}`);
    lines.push(`    ${position.token1Symbol || 'Token1'}: ${position.formatted?.withdrawToken1}`);
    lines.push('');

    lines.push('  💰 Total Fees Collected:');
    lines.push(`    ${position.token0Symbol || 'Token0'}: ${position.formatted?.feesToken0}`);
    lines.push(`    ${position.token1Symbol || 'Token1'}: ${position.formatted?.feesToken1}`);
    lines.push('');

    lines.push('  💹 Net LP Position Change (excluding fees):');
    const net0 = position.netLpToken0Change >= 0n ? '+' : '';
    const net1 = position.netLpToken1Change >= 0n ? '+' : '';
    lines.push(`    ${position.token0Symbol || 'Token0'}: ${net0}${position.formatted?.netLpToken0Change}`);
    lines.push(`    ${position.token1Symbol || 'Token1'}: ${net1}${position.formatted?.netLpToken1Change}`);
    lines.push('-'.repeat(80));
  }

  return lines.join('\n');
}

/**
 * Track lending positions (AAVE/Euler) across multiple transactions
 * Analyzes supply/withdraw actions to calculate deposits, withdrawals, and interest earned
 */
export function trackLendingPositions(
  parsedTransactions: Array<{ txHash: string; parsed: ParsedTransaction }>,
  chainId: string = '8453',
): LendingPositionSummary {
  const positions = new Map<string, LendingPositionTracking>();

  // Collect all lending events from all transactions
  for (const { txHash, parsed } of parsedTransactions) {
    for (const action of parsed.actions) {
      // Only track AAVE and Euler lending actions
      if (
        (action.protocol !== Protocol.AAVE && action.protocol !== Protocol.EULER) ||
        (action.type !== RebalanceActionType.SUPPLY && action.type !== RebalanceActionType.WITHDRAW)
      ) {
        continue;
      }

      // Get token from the first token in the action
      const token = action.tokens[0]?.token;
      if (!token) continue;

      // Create a unique key for this protocol + token combination
      const positionKey = `${action.protocol}_${token}`;

      // Initialize position if not exists
      if (!positions.has(positionKey)) {
        positions.set(positionKey, {
          token,
          tokenSymbol: action.tokens[0]?.symbol,
          protocol: action.protocol,
          vaultAddress: action.protocol === Protocol.EULER ? action.contractAddress : undefined,
          events: [],
          cycles: [],
          totalSupplied: 0n,
          totalWithdrawn: 0n,
          totalInterestEarned: 0n,
        });
      }

      const position = positions.get(positionKey)!;
      const amount = BigInt(action.tokens[0]?.amount || '0');

      // Add event to position
      const event: PositionEvent = {
        txHash,
        timestamp: parsed.timestamp,
        blockNumber: parsed.blockNumber,
        eventIndex: action.eventIndex,
        logIndex: action.logIndex,
        type: action.type,
        token0: token,
        token1: '', // Not used for lending
        token0Amount: amount,
        token1Amount: 0n,
        token0Symbol: action.tokens[0]?.symbol,
        token1Symbol: undefined,
      };

      position.events.push(event);

      // Update aggregated amounts
      if (action.type === RebalanceActionType.SUPPLY) {
        position.totalSupplied += amount;

        // Track first supply timestamp
        if (!position.firstSupplyTimestamp && parsed.timestamp) {
          position.firstSupplyTimestamp = parsed.timestamp;
        }
      } else if (action.type === RebalanceActionType.WITHDRAW) {
        position.totalWithdrawn += amount;

        // Track last withdraw timestamp
        if (parsed.timestamp) {
          if (!position.lastWithdrawTimestamp || parsed.timestamp > position.lastWithdrawTimestamp) {
            position.lastWithdrawTimestamp = parsed.timestamp;
          }
        }
      }
    }
  }

  // Sort events and calculate interest for all positions
  for (const position of positions.values()) {
    // Sort events chronologically
    position.events.sort((a, b) => {
      if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }
      if (a.logIndex !== b.logIndex) {
        return a.logIndex - b.logIndex;
      }
      return a.eventIndex - b.eventIndex;
    });

    // Get token info once for this position
    const tokenInfo = getTokenInfo(position.token, chainId);
    if (tokenInfo.symbol) position.tokenSymbol = tokenInfo.symbol;

    // Calculate running balance after each event
    let runningBalance = 0n;

    for (const event of position.events) {
      if (event.type === RebalanceActionType.SUPPLY) {
        runningBalance += event.token0Amount;
      } else if (event.type === RebalanceActionType.WITHDRAW) {
        runningBalance -= event.token0Amount;
      }

      event.runningBalance = runningBalance;
      event.formattedRunningBalance = formatAmount(runningBalance.toString(), tokenInfo.decimals);
    }

    // Calculate interest earned
    position.totalInterestEarned = position.totalWithdrawn - position.totalSupplied;

    // Calculate holding duration
    if (position.firstSupplyTimestamp && position.lastWithdrawTimestamp) {
      position.holdingDurationSeconds = position.lastWithdrawTimestamp - position.firstSupplyTimestamp;
    }

    // Match supply-withdraw cycles using FIFO (First In First Out)
    const supplyQueue: PositionEvent[] = [];
    const cycles: LendingCycle[] = [];

    for (const event of position.events) {
      if (event.type === RebalanceActionType.SUPPLY) {
        // Add to supply queue
        supplyQueue.push(event);
      } else if (event.type === RebalanceActionType.WITHDRAW) {
        // Try to match with supplies in queue
        let remainingWithdraw = event.token0Amount;

        while (remainingWithdraw > 0n && supplyQueue.length > 0) {
          const supplyEvent = supplyQueue[0];
          const supplyAmount = supplyEvent.token0Amount;

          if (supplyAmount <= remainingWithdraw) {
            // Fully match this supply
            // The withdraw amount that matches this supply is proportional
            const matchedWithdrawAmount = supplyAmount;
            const profit = 0n; // Will calculate profit based on total cycle later

            const cycle: LendingCycle = {
              supplyEvent: { ...supplyEvent }, // Clone to preserve original
              withdrawEvents: [event],
              supplyAmount,
              withdrawnAmount: matchedWithdrawAmount,
              profit, // Placeholder, will calculate below
              holdingDurationSeconds:
                supplyEvent.timestamp && event.timestamp ? event.timestamp - supplyEvent.timestamp : undefined,
            };

            cycles.push(cycle);
            supplyQueue.shift(); // Remove from queue
            remainingWithdraw -= matchedWithdrawAmount;
          } else {
            // Partial match: withdraw amount is less than supply amount
            const matchedWithdrawAmount = remainingWithdraw;
            const matchedSupplyAmount = remainingWithdraw;

            const cycle: LendingCycle = {
              supplyEvent: { ...supplyEvent }, // Clone
              withdrawEvents: [event],
              supplyAmount: matchedSupplyAmount,
              withdrawnAmount: matchedWithdrawAmount,
              profit: 0n, // Placeholder
              holdingDurationSeconds:
                supplyEvent.timestamp && event.timestamp ? event.timestamp - supplyEvent.timestamp : undefined,
            };

            cycles.push(cycle);

            // Update supply event amount (partially withdrawn)
            supplyEvent.token0Amount -= matchedSupplyAmount;
            remainingWithdraw = 0n;
          }
        }

        // If there's still remaining withdraw amount, it's profit (or from a previous untracked supply)
        if (remainingWithdraw > 0n) {
          // This withdraw has more than all supplies - the excess is profit/interest
          // We'll attribute this to the last matched cycle if any
          if (cycles.length > 0) {
            const lastCycle = cycles[cycles.length - 1];
            lastCycle.withdrawnAmount += remainingWithdraw;
            lastCycle.profit = lastCycle.withdrawnAmount - lastCycle.supplyAmount;
          }
        }

        // Calculate profit for cycles that have been completed
        for (const cycle of cycles) {
          if (cycle.profit === 0n && cycle.withdrawnAmount > cycle.supplyAmount) {
            cycle.profit = cycle.withdrawnAmount - cycle.supplyAmount;
          }
        }
      }
    }

    position.cycles = cycles;

    // Format cycles
    for (const cycle of position.cycles) {
      cycle.formatted = {
        supplyAmount: formatAmount(cycle.supplyAmount.toString(), tokenInfo.decimals) || cycle.supplyAmount.toString(),
        withdrawnAmount:
          formatAmount(cycle.withdrawnAmount.toString(), tokenInfo.decimals) || cycle.withdrawnAmount.toString(),
        profit: formatAmount(cycle.profit.toString(), tokenInfo.decimals) || cycle.profit.toString(),
        holdingDuration: cycle.holdingDurationSeconds ? formatDuration(cycle.holdingDurationSeconds) : undefined,
      };
    }

    // Format amounts

    position.formatted = {
      totalSupplied:
        formatAmount(position.totalSupplied.toString(), tokenInfo.decimals) || position.totalSupplied.toString(),
      totalWithdrawn:
        formatAmount(position.totalWithdrawn.toString(), tokenInfo.decimals) || position.totalWithdrawn.toString(),
      totalInterestEarned:
        formatAmount(position.totalInterestEarned.toString(), tokenInfo.decimals) ||
        position.totalInterestEarned.toString(),
      holdingDuration: position.holdingDurationSeconds ? formatDuration(position.holdingDurationSeconds) : undefined,
    };
  }

  return { positions };
}

/**
 * Format lending position summary as human-readable text
 */
export function formatLendingPositions(summary: LendingPositionSummary, chainId: string = '8453'): string {
  const lines: string[] = [];

  if (summary.positions.size === 0) {
    return 'No lending positions found';
  }

  lines.push(`\nLending Position Summary (${summary.positions.size} positions):`);
  lines.push('='.repeat(80));

  for (const position of summary.positions.values()) {
    lines.push(`\nProtocol: ${position.protocol}`);
    lines.push(`Token: ${position.tokenSymbol || position.token}`);
    if (position.vaultAddress) {
      lines.push(`Vault Address: ${position.vaultAddress}`);
    }
    lines.push(`Total Events: ${position.events.length}`);
    lines.push('');

    // Show event timeline
    if (position.events.length > 0) {
      lines.push('  📅 Event Timeline:');
      for (const event of position.events) {
        const timeStr = event.timestamp
          ? new Date(event.timestamp * 1000).toISOString()
          : `Block ${event.blockNumber}`;
        const actionEmoji = getLendingActionEmoji(event.type);

        const tokenInfo = getTokenInfo(event.token0, chainId);
        const amountFormatted =
          formatAmount(event.token0Amount.toString(), tokenInfo.decimals) || event.token0Amount.toString();

        lines.push(`    ${actionEmoji} ${timeStr}`);
        lines.push(`       ${event.type}`);
        lines.push(`       Tx: ${event.txHash}`);
        lines.push(`       Amount: ${event.token0Symbol || 'Token'}: ${amountFormatted}`);

        // Show running balance after this event
        if (event.runningBalance !== undefined) {
          const balanceFormatted = event.formattedRunningBalance || event.runningBalance.toString();
          const isNearZero =
            event.runningBalance >= -1000000000000000n && event.runningBalance <= 1000000000000000n; // Within 0.001 for 18 decimals

          if (isNearZero) {
            lines.push(`       → Balance after: ${balanceFormatted} ${event.token0Symbol || 'Token'} ⚠️  (Near Zero)`);
          } else {
            lines.push(`       → Balance after: ${balanceFormatted} ${event.token0Symbol || 'Token'}`);
          }
        }
      }
      lines.push('');
    }

    // Show aggregated summary
    lines.push('  📊 Aggregated Summary:');
    lines.push('');

    // Show holding duration if available
    if (position.formatted?.holdingDuration) {
      lines.push('  ⏱️  Holding Duration:');
      lines.push(`    ${position.formatted.holdingDuration}`);
      if (position.firstSupplyTimestamp) {
        lines.push(`    From: ${new Date(position.firstSupplyTimestamp * 1000).toISOString()}`);
      }
      if (position.lastWithdrawTimestamp) {
        lines.push(`    To: ${new Date(position.lastWithdrawTimestamp * 1000).toISOString()}`);
      }
      lines.push('');
    }

    lines.push('  💵 Total Supplied (Deposits):');
    lines.push(`    ${position.tokenSymbol || 'Token'}: ${position.formatted?.totalSupplied}`);
    lines.push('');

    lines.push('  💸 Total Withdrawn:');
    lines.push(`    ${position.tokenSymbol || 'Token'}: ${position.formatted?.totalWithdrawn}`);
    lines.push('');

    lines.push('  💰 Interest Earned:');
    const interestSign = position.totalInterestEarned >= 0n ? '+' : '';
    lines.push(`    ${position.tokenSymbol || 'Token'}: ${interestSign}${position.formatted?.totalInterestEarned}`);
    lines.push('');

    // Show final balance (remaining in position)
    const finalBalance = position.totalSupplied - position.totalWithdrawn;
    const tokenInfo = getTokenInfo(position.token, chainId);
    const finalBalanceFormatted = formatAmount(finalBalance.toString(), tokenInfo.decimals) || finalBalance.toString();
    const isFinalNearZero = finalBalance >= -1000000000000000n && finalBalance <= 1000000000000000n;

    lines.push('  💼 Current Balance (Remaining in Position):');
    if (isFinalNearZero) {
      lines.push(`    ${position.tokenSymbol || 'Token'}: ${finalBalanceFormatted} ⚠️  (Near Zero - Position Closed)`);
    } else if (finalBalance > 0n) {
      lines.push(`    ${position.tokenSymbol || 'Token'}: ${finalBalanceFormatted} (Still Active)`);
    } else {
      lines.push(`    ${position.tokenSymbol || 'Token'}: ${finalBalanceFormatted}`);
    }
    lines.push('');

    // Show supply-withdraw cycles
    if (position.cycles.length > 0) {
      lines.push(`  🔄 Supply-Withdraw Cycles (${position.cycles.length} cycles):`);
      lines.push('');

      for (let i = 0; i < position.cycles.length; i++) {
        const cycle = position.cycles[i];
        const cycleNum = i + 1;

        lines.push(`    Cycle #${cycleNum}:`);

        const supplyTime = cycle.supplyEvent.timestamp
          ? new Date(cycle.supplyEvent.timestamp * 1000).toISOString()
          : `Block ${cycle.supplyEvent.blockNumber}`;
        lines.push(`      💵 Supply: ${cycle.formatted?.supplyAmount} ${position.tokenSymbol || 'Token'}`);
        lines.push(`         at ${supplyTime}`);
        lines.push(`         Tx: ${cycle.supplyEvent.txHash}`);

        for (const withdrawEvent of cycle.withdrawEvents) {
          const withdrawTime = withdrawEvent.timestamp
            ? new Date(withdrawEvent.timestamp * 1000).toISOString()
            : `Block ${withdrawEvent.blockNumber}`;
          lines.push(`      💸 Withdraw: ${cycle.formatted?.withdrawnAmount} ${position.tokenSymbol || 'Token'}`);
          lines.push(`         at ${withdrawTime}`);
          lines.push(`         Tx: ${withdrawEvent.txHash}`);
        }

        const profitSign = cycle.profit >= 0n ? '+' : '';
        const profitLabel = cycle.profit >= 0n ? '💰 Profit' : '📉 Loss';
        lines.push(`      ${profitLabel}: ${profitSign}${cycle.formatted?.profit} ${position.tokenSymbol || 'Token'}`);

        if (cycle.formatted?.holdingDuration) {
          lines.push(`      ⏱️  Duration: ${cycle.formatted.holdingDuration}`);
        }

        lines.push('');
      }
    }

    lines.push('-'.repeat(80));
  }

  return lines.join('\n');
}
