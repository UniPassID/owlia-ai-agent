import { Injectable, Logger } from '@nestjs/common';
import {
  GetDexPoolsResponse,
  GetLpSimulateResponse,
  GetSupplyOpportunitiesResponse,
} from '../../agent/types/mcp.types';
import {
  AllocationResult,
  HoldingsState,
  MarginalScore,
  Opportunity,
  OptimizationOptions,
} from './types';
import { CostCalculatorService } from './cost-calculator.service';

@Injectable()
export class MarginalOptimizerService {
  private readonly logger = new Logger(MarginalOptimizerService.name);

  constructor(private readonly costCalculator: CostCalculatorService) {}

  /**
   * Marginal greedy optimization algorithm with real cost data
   * Iteratively allocates capital to the opportunity with highest marginal net APY
   */
  async optimizePortfolio(
    opportunities: Opportunity[],
    totalCapital: number,
    options: OptimizationOptions,
    walletAddress: string,
    chainId: string,
    currentHoldings: Record<string, number>,
    lpSimulations: GetLpSimulateResponse[],
    supplyData: GetSupplyOpportunitiesResponse[],
    dexPools: Record<string, any>,
    useRealCost: boolean = true,
    useRealAPY: boolean = true,
  ): Promise<AllocationResult> {
    const allocations = new Map<string, number>();
    opportunities.forEach(opp => allocations.set(opp.id, 0));

    let remainingCapital = totalCapital;
    const allocationHistory: AllocationResult['allocationHistory'] = [];

    // Track holdings state: initial holdings, used amounts, and swapped tokens
    const holdingsState: HoldingsState = {
      currentHoldings,
      usedHoldings: {},
      swappedTokens: new Set<string>(),
    };

    this.logger.log(
      `Starting marginal optimization with ${opportunities.length} opportunities, ` +
      `total capital=$${totalCapital}, increment=$${options.incrementSize}, ` +
      `initial holdings=${JSON.stringify(currentHoldings)}`
    );

    let iteration = 0;
    const maxIterations = 100;

    while (remainingCapital >= options.incrementSize && iteration < maxIterations) {
      iteration++;

      // Calculate marginal scores for all opportunities (serially)
      const marginalScores: MarginalScore[] = [];
      for (const opp of opportunities) {
        const currentAlloc = allocations.get(opp.id)!;
        const incrementAmount = Math.min(
          options.incrementSize,
          remainingCapital,
          opp.maxAmount - currentAlloc,
        );

        if (incrementAmount <= 0) continue;

        const hasExistingPosition = currentAlloc > 0;

        const score = await this.calculateMarginalNetAPY(
          opp,
          currentAlloc,
          incrementAmount,
          options.holdingPeriodDays,
          hasExistingPosition,
          walletAddress,
          chainId,
          holdingsState,
          lpSimulations,
          supplyData,
          dexPools,
          useRealCost,
          useRealAPY,
        );

        if (score !== null) {
          marginalScores.push(score);
        }
      }

      // Filter by constraints and find best
      const validScores = marginalScores.filter(
        s =>
          s.netAPY > options.minMarginalAPY &&
          s.breakevenHours < options.maxBreakevenHours,
      );

      if (validScores.length === 0) {
        this.logger.log(
          `Stopping optimization at iteration ${iteration}: No valid opportunities remain`
        );
        break;
      }

      // Sort by net APY and select best
      validScores.sort((a, b) => b.netAPY - a.netAPY);
      const best = validScores[0];

      // Allocate to best opportunity
      allocations.set(best.opp.id, allocations.get(best.opp.id)! + best.amount);
      remainingCapital -= best.amount;

      // Update used holdings and mark tokens as swapped
      // This prevents double-counting available holdings and gas fees
      this.updateUsedHoldingsAndMarkSwapped(
        holdingsState,
        best.opp,
        best.amount,
        lpSimulations,
        supplyData,
        dexPools,
        chainId,
      );

      allocationHistory.push({
        oppId: best.opp.id,
        amount: best.amount,
        netAPY: best.netAPY,
        totalAllocated: allocations.get(best.opp.id)!,
        swapCost: best.swapCost,
      } as any);

      this.logger.log(
        `Iteration ${iteration}: Allocated $${best.amount.toFixed(2)} to ${best.opp.id}, ` +
        `marginal netAPY=${best.netAPY.toFixed(2)}% (gross=${best.grossAPY.toFixed(2)}%), ` +
        `breakeven=${best.breakevenHours.toFixed(2)}h, ` +
        `swapCost=$${best.swapCost.toFixed(2)}, ` +
        `total to this opp=$${allocations.get(best.opp.id)!.toFixed(2)}, ` +
        `remaining=$${remainingCapital.toFixed(2)}`
      );
    }

    // Build final positions
    const positions = Array.from(allocations.entries())
      .filter(([_, amount]) => amount > 0)
      .map(([oppId, amount]) => {
        const opp = opportunities.find(o => o.id === oppId)!;
        return {
          opportunity: opp,
          amount,
          apy: opp.getAPY(amount),
        };
      });

    const totalInvested = totalCapital - remainingCapital;
    const weightedAPY = positions.reduce(
      (sum, p) => sum + (p.apy * p.amount) / totalInvested,
      0,
    );

    const totalSwapCost = allocationHistory.reduce((sum, h: any) => {
      return sum + (h.swapCost || 0);
    }, 0);

    this.logger.log(
      `Optimization complete: ${positions.length} positions, ` +
      `invested=$${totalInvested.toFixed(2)}/${totalCapital.toFixed(2)}, ` +
      `weighted APY=${weightedAPY.toFixed(2)}%, ` +
      `total swap cost=$${totalSwapCost.toFixed(2)}`
    );

    return {
      positions,
      totalInvested,
      weightedAPY,
      allocationHistory,
      totalSwapCost,
    };
  }

  /**
   * Calculate marginal net APY for an opportunity with real cost data
   */
  private async calculateMarginalNetAPY(
    opp: Opportunity,
    currentAllocation: number,
    incrementAmount: number,
    holdingPeriodDays: number,
    hasExistingPosition: boolean,
    walletAddress: string,
    chainId: string,
    holdingsState: HoldingsState,
    lpSimulations: GetLpSimulateResponse[],
    supplyData: GetSupplyOpportunitiesResponse[],
    dexPools: Record<string, any>,
    useRealCost: boolean,
    useRealAPY: boolean,
  ): Promise<MarginalScore> {
    // Adjust holding period based on opportunity type
    // Supply positions are more stable (no out-of-range risk), use shorter period: 7 days
    // LP positions may go out of range frequently, use longer period: 30 days
    const effectiveHoldingPeriodDays = opp.type === 'supply' ? 7 : holdingPeriodDays;

    // 1. Calculate marginal APY using midpoint method
    // Use the APY at the midpoint of [currentAllocation, currentAllocation + incrementAmount]
    // This is more accurate than averaging endpoints, especially when currentAllocation = 0
    const midpoint = currentAllocation + incrementAmount / 2;

    let avgMarginalAPY: number;
    if (useRealAPY && opp.getAPYAsync) {
      avgMarginalAPY = await opp.getAPYAsync(midpoint);
    } else {
      avgMarginalAPY = opp.getAPY(midpoint);
    }

    if (opp.type === 'lp') {
      // for lp, 70% apy is effective
      avgMarginalAPY = avgMarginalAPY * 0.7;
    }


    // 2. Get swap cost (real or estimated)
    let swapCost: number;

    if (useRealCost) {
      // Get target tokens for this opportunity
      const targetTokens = this.costCalculator.getTargetTokensForOpportunity(
        opp,
        incrementAmount,
        chainId,
        lpSimulations,
        supplyData,
        dexPools,
      );

      // Calculate swap cost for each token separately
      // This allows us to apply gas fee only to tokens being swapped for the first time
      swapCost = 0;
      const gasPerSwap = 0.01; // USD per swap transaction
      const availableHoldings: Record<string, number> = {};

      for (const [symbol, total] of Object.entries(holdingsState.currentHoldings)) {
        const used = holdingsState.usedHoldings[symbol] || 0;
        const available = total - used;
        if (available > 0) {
          availableHoldings[symbol] = available;
        }
      }

      const availableStableHoldings = this.costCalculator.createStableHoldingsMap(
        chainId,
        availableHoldings,
      );

      for (const { symbol, amount: requiredAmount } of targetTokens) {
        // Calculate available amount: initial holdings minus already used
        const normalizedSymbol = (symbol || '').toUpperCase();
        const totalHoldings =
          holdingsState.currentHoldings[symbol] ??
          holdingsState.currentHoldings[normalizedSymbol] ??
          0;
        const alreadyUsed =
          holdingsState.usedHoldings[symbol] ??
          holdingsState.usedHoldings[normalizedSymbol] ??
          0;
        const availableAmount = totalHoldings - alreadyUsed;
        const deficit = requiredAmount - availableAmount;

        if (deficit > 0) {
          // Need to swap to get this token
          const isFirstTimeSwapForToken = !holdingsState.swappedTokens.has(symbol);

          if (isFirstTimeSwapForToken) {
            swapCost += gasPerSwap; // Gas cost for first-time swap
          }

          // DEX fee + slippage (always applies)
          const { cost } = await this.costCalculator.estimateSwapCostForToken(
            chainId,
            normalizedSymbol,
            deficit,
            { availableStableHoldings },
          );
          swapCost += cost;
        }
      }
    } else {
      swapCost = this.estimateSwapCostFallback(incrementAmount, hasExistingPosition);
    }

    // 3. Calculate annualized cost rate using effective holding period
    const annualizedCostRate = (swapCost / incrementAmount) * (365 / effectiveHoldingPeriodDays);

    // 4. Net APY (in percentage points)
    const netAPY = avgMarginalAPY - annualizedCostRate * 100;

    // 5. Calculate breakeven time
    let breakevenHours = 0;
    if (netAPY > 0 && incrementAmount > 0) {
      const hourlyGainRate = avgMarginalAPY / 100 / 365 / 24;
      const hourlyGain = incrementAmount * hourlyGainRate;
      if (hourlyGain > 0) {
        breakevenHours = swapCost / hourlyGain;
      }
    } else {
      breakevenHours = Infinity;
    }

    

    return {
      opp,
      netAPY,
      breakevenHours,
      amount: incrementAmount,
      swapCost,
      grossAPY: avgMarginalAPY,
    };
  }

  /**
   * Update used holdings and mark tokens as swapped after allocation
   * This prevents double-counting available holdings and gas fees
   */
  private updateUsedHoldingsAndMarkSwapped(
    holdingsState: HoldingsState,
    opp: Opportunity,
    amount: number,
    lpSimulations: GetLpSimulateResponse[],
    supplyData: GetSupplyOpportunitiesResponse[],
    dexPools: Record<string, any>,
    chainId: string,
  ): void {
    // Get target tokens for this opportunity
    const targetTokens = this.costCalculator.getTargetTokensForOpportunity(
      opp,
      amount,
      chainId,
      lpSimulations,
      supplyData,
      dexPools,
    );

    const newlySwappedTokens: string[] = [];
    const usedTokensLog: Record<string, number> = {};

    for (const { symbol, amount: requiredAmount } of targetTokens) {
      // Update used holdings
      holdingsState.usedHoldings[symbol] = (holdingsState.usedHoldings[symbol] || 0) + requiredAmount;
      usedTokensLog[symbol] = requiredAmount;

      // Mark tokens that required swapping (not already in holdings)
      const totalHoldings = holdingsState.currentHoldings[symbol] || 0;
      const alreadyUsed = (holdingsState.usedHoldings[symbol] || 0) - requiredAmount; // Before this allocation
      const availableAmount = totalHoldings - alreadyUsed;
      const deficit = requiredAmount - availableAmount;

      if (deficit > 0 && !holdingsState.swappedTokens.has(symbol)) {
        holdingsState.swappedTokens.add(symbol);
        newlySwappedTokens.push(symbol);
      }
    }

    this.logger.debug(
      `Allocated $${amount} to ${opp.id}: ` +
      `used=${JSON.stringify(usedTokensLog)}, ` +
      `newly swapped=${JSON.stringify(newlySwappedTokens)}, ` +
      `total used=${JSON.stringify(holdingsState.usedHoldings)}`
    );
  }

  private estimateSwapCostFallback(amount: number, hasExistingPosition: boolean): number {
    const gasCost = hasExistingPosition ? 0 : 5;
    const swapFeeRate = 0.004;
    const variableCost = amount * swapFeeRate;
    return gasCost + variableCost;
  }
}
