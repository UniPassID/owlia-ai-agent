import { Injectable, Logger } from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { User } from '../entities/user.entity';
import { UserPolicy } from '../entities/user-policy.entity';
import {
  AccountYieldSummaryResponse,
  ChainId,
  GetLpSimulateRequest,
  GetLpSimulateResponse,
  GetSupplyOpportunitiesResponse,
  CalculateRebalanceCostBatchRequest,
  CalculateRebalanceCostBatchResponse,
} from '../agent/types/mcp.types';
import { lookupTokenAddress } from '../agent/token-utils';

export interface RebalancePrecheckResult {
  shouldTrigger: boolean;
  portfolioApy: number;
  opportunityApy: number;
  differenceBps: number;
  totalPortfolioValueUsd: number;
  yieldSummary?: AccountYieldSummaryResponse;
  gasEstimate?: number;
  breakEvenTimeHours?: number;
  netGainUsd?: number;
  failureReason?: string;
}

@Injectable()
export class RebalancePrecheckService {
  private readonly logger = new Logger(RebalancePrecheckService.name);
  private readonly lpSimulationAmountUsd = 1000;
  private readonly lpSimulationTimeHorizonMinutes = 30;

  constructor(private readonly agentService: AgentService) {}

  async evaluate(user: User, policy: UserPolicy | null): Promise<RebalancePrecheckResult> {
    const chainId = this.normalizeChainId(user.chainId) as ChainId;

    const lpSimulationResults: GetLpSimulateResponse[] = [];
    const supplyOpportunitiesByChain: GetSupplyOpportunitiesResponse[] = [];
    let yieldSummary: AccountYieldSummaryResponse | null = null;
    let dexPools: Record<string, any> = {};

    try {
      yieldSummary = await this.agentService.callMcpTool<AccountYieldSummaryResponse>('get_account_yield_summary', {
        wallet_address: user.address,
        chain_id: chainId,
      });
      this.logger.log(`get_account_yield_summary result: ${JSON.stringify(yieldSummary)}`);
    } catch (error) {
      this.logger.warn(`get_account_yield_summary failed for user ${user.id} on chain ${chainId}: ${error.message}`);
    }

    if (!yieldSummary) {
      return {
        shouldTrigger: false,
        portfolioApy: 0,
        opportunityApy: 0,
        differenceBps: 0,
        totalPortfolioValueUsd: 0,
      };
    }

    const totalAssetsUsd = this.parseNumber(yieldSummary.totalAssetsUsd) || 0;
    const portfolioApy = this.parseNumber(yieldSummary.portfolioApy) || 0;

    this.logger.log(
      `Portfolio summary for user ${user.id}: totalAssetsUsd=${totalAssetsUsd}, portfolioApy=${portfolioApy}`,
    );

    if (totalAssetsUsd < 50) {
      return {
        shouldTrigger: false,
        portfolioApy,
        opportunityApy: 0,
        differenceBps: 0,
        totalPortfolioValueUsd: totalAssetsUsd,
        yieldSummary,
      };
    }

    try {
      dexPools = await this.agentService.callMcpTool<Record<string, any>>('get_dex_pools', {
        chain_id: chainId,
      });
      const lpRequests = this.buildLpSimulateRequests(chainId, dexPools, totalAssetsUsd);
      if (lpRequests.length > 0) {
        this.logger.log(`Simulating ${lpRequests.length} LP pools for user ${user.id}`);
        const simulationsRaw = await this.agentService.callMcpTool<any>(
          'get_lp_simulate_batch',
          { reqs: lpRequests },
        );
        const simulations = this.normalizeDictionaryResponse<GetLpSimulateResponse>(simulationsRaw);
        this.logger.log(`LP simulation results for user ${user.id}: ${JSON.stringify(simulations)}`);
        lpSimulationResults.push(...simulations);
      } else {
        this.logger.log(`No LP simulation requests generated for user ${user.id}`);
      }
    } catch (error) {
      this.logger.warn(`LP simulation batch failed for user ${user.id} on chain ${chainId}: ${error.message}`);
    }

    try {
      const supplyOpps = await this.agentService.callMcpTool<GetSupplyOpportunitiesResponse>('get_supply_opportunities', {
        chain_id: chainId,
        amount: totalAssetsUsd,
      });
      this.logger.log(`Supply opportunities for user ${user.id}: ${JSON.stringify(supplyOpps)}`);
      supplyOpportunitiesByChain.push(supplyOpps);
    } catch (error) {
      this.logger.warn(`get_supply_opportunities failed for user ${user.id} on chain ${chainId}: ${error.message}`);
    }

    // Step 1: Build all possible strategies from opportunities
    const allStrategies = this.buildAllStrategies(
      lpSimulationResults,
      supplyOpportunitiesByChain,
      totalAssetsUsd,
      chainId,
    );

    if (allStrategies.length === 0) {
      this.logger.log(`Precheck REJECTED for user ${user.id}: No valid strategies found`);
      return {
        shouldTrigger: false,
        portfolioApy,
        opportunityApy: 0,
        differenceBps: 0,
        totalPortfolioValueUsd: totalAssetsUsd,
        yieldSummary,
        failureReason: 'No valid strategies',
      };
    }

    this.logger.log(`Built ${allStrategies.length} strategies for user ${user.id}`);

    // Step 2: Calculate rebalance cost for all strategies in batch
    let gasEstimate = 0;
    let breakEvenTimeHours = 0;
    let netGainUsd = 0;
    let bestStrategyName = '';
    let bestStrategyApy = 0;

    try {
      // Convert strategies to target_positions_batch format
      const targetPositionsBatch = allStrategies.map(s =>
        this.convertStrategyToTargetPositions(s.strategy, lpSimulationResults, supplyOpportunitiesByChain, dexPools, chainId)
      );

      const request: CalculateRebalanceCostBatchRequest = {
        wallet_address: user.address,
        chain_id: chainId as ChainId,
        target_positions_batch: targetPositionsBatch,
      };

      this.logger.log(`Calling calculate_rebalance_cost_batch with ${targetPositionsBatch.length} scenarios`);

      const costResult = await this.agentService.callMcpTool<CalculateRebalanceCostBatchResponse>(
        'calculate_rebalance_cost_batch',
        request,
      );

      this.logger.log(`Cost analysis result: ${JSON.stringify(costResult)}`);

      // Convert dictionary response to array of results
      const resultsArray = this.normalizeDictionaryResponse<any>(costResult);

      // Find the best strategy based on break-even time and net gain
      let bestStrategyIndex = -1;
      let bestScore = -Infinity;

      if (resultsArray && resultsArray.length > 0) {
        resultsArray.forEach((result, index) => {
          if (index >= allStrategies.length) {
            return; // Skip if index exceeds strategies array
          }

          // Currently MCP only returns swap_fee, so we use it as the total cost
          const swapFee = this.parseNumber(result.swap_fee) || 0;
          const totalCost = swapFee;

          const strategyApy = allStrategies[index].apy;
          const apyImprovement = strategyApy - portfolioApy;

          // Calculate break-even time based on swap fee and APY improvement
          // Break-even time (hours) = (total cost / annual gain) * 365 * 24
          let breakEven = 0;
          if (apyImprovement > 0 && totalAssetsUsd > 0) {
            const annualGain = (totalAssetsUsd * apyImprovement) / 100;
            if (annualGain > 0) {
              breakEven = (totalCost / annualGain) * 365 * 24;
            }
          }

          // Calculate estimated net gain (daily)
          // Daily gain from APY improvement minus amortized cost over 30 days
          const dailyGainRate = (apyImprovement / 100) / 365;
          const dailyGain = totalAssetsUsd * dailyGainRate;
          const dailyCost = totalCost / 30; // Amortize swap fee over 30 days
          const netGain = dailyGain - dailyCost;

          // Score: prioritize higher net gain and lower break-even time
          // Formula: netGain / (breakEvenHours + 1) to avoid division by zero
          const score = netGain / (breakEven + 1);

          this.logger.log(
            `Strategy ${index} (${allStrategies[index].name}): ` +
            `APY=${strategyApy.toFixed(2)}% (current=${portfolioApy.toFixed(2)}%, improvement=+${apyImprovement.toFixed(2)}pp), ` +
            `swap_fee=$${swapFee.toFixed(4)}, ` +
            `break-even=${breakEven.toFixed(2)}h, ` +
            `daily_net_gain=$${netGain.toFixed(4)}, ` +
            `score=${score.toFixed(4)}`,
          );

          if (score > bestScore) {
            bestScore = score;
            bestStrategyIndex = index;
            gasEstimate = totalCost;
            breakEvenTimeHours = breakEven;
            netGainUsd = netGain;
            bestStrategyName = allStrategies[index].name;
            bestStrategyApy = allStrategies[index].apy;
          }
        });
      }

      if (bestStrategyIndex === -1 && allStrategies.length > 0) {
        // Fallback: use first strategy if no valid cost results
        this.logger.warn(`No valid cost results, using first strategy as fallback`);
        bestStrategyName = allStrategies[0].name;
        bestStrategyApy = allStrategies[0].apy;
      }
    } catch (error) {
      this.logger.warn(`Cost calculation failed for user ${user.id}: ${error.message}`);
      // Continue with default values (0) - don't fail the entire precheck
      if (allStrategies.length > 0) {
        bestStrategyName = allStrategies[0].name;
        bestStrategyApy = allStrategies[0].apy;
      }
    }

    // Step 3: Check break-even time condition
    const maxBreakEvenHours = 4;
    const breakEvenConditionSatisfied = breakEvenTimeHours <= maxBreakEvenHours;

    if (!breakEvenConditionSatisfied) {
      this.logger.log(
        `Precheck REJECTED for user ${user.id}: Break-even time too long. ` +
        `Break-even=${breakEvenTimeHours.toFixed(2)}h (max ${maxBreakEvenHours}h), ` +
        `Gas=$${gasEstimate.toFixed(2)}`,
      );

      return {
        shouldTrigger: false,
        portfolioApy,
        opportunityApy: bestStrategyApy,
        differenceBps: (bestStrategyApy - portfolioApy) * 100,
        totalPortfolioValueUsd: totalAssetsUsd,
        yieldSummary,
        gasEstimate,
        breakEvenTimeHours,
        netGainUsd,
        failureReason: 'Break-even time exceeds 4 hours',
      };
    }

    // Step 4: Calculate APY metrics for the best strategy
    const opportunityApy = bestStrategyApy;
    const difference = opportunityApy - portfolioApy;
    const differenceBps = difference * 100;

    // Step 5: Check APY conditions
    // New APY must satisfy BOTH conditions:
    // a) Relative increase: new APY ÷ current APY >= 1.1 (at least 10% higher)
    // b) Absolute increase: new APY - current APY >= 2 percentage points
    const relativeIncrease = portfolioApy > 0 ? (opportunityApy / portfolioApy) : Infinity;
    const absoluteIncrease = opportunityApy - portfolioApy;

    const apyConditionsSatisfied = relativeIncrease >= 1.1 && absoluteIncrease >= 2;

    if (!apyConditionsSatisfied) {
      this.logger.log(
        `Precheck REJECTED for user ${user.id}: APY conditions not met. ` +
        `Portfolio APY=${portfolioApy.toFixed(2)}%, Best strategy APY=${opportunityApy.toFixed(2)}%, ` +
        `Relative=${relativeIncrease.toFixed(2)}x (need >=1.1), Absolute=${absoluteIncrease.toFixed(2)}pp (need >=2)`,
      );

      return {
        shouldTrigger: false,
        portfolioApy,
        opportunityApy,
        differenceBps,
        totalPortfolioValueUsd: totalAssetsUsd,
        yieldSummary,
        gasEstimate,
        breakEvenTimeHours,
        netGainUsd,
        failureReason: 'APY improvement insufficient',
      };
    }

    // All conditions satisfied
    const shouldTrigger = true;

    this.logger.log(
      `Precheck APPROVED for user ${user.id}: ` +
      `Best strategy: ${bestStrategyName}, ` +
      `Portfolio APY=${portfolioApy.toFixed(2)}%, Opportunity APY=${opportunityApy.toFixed(2)}%, ` +
      `Diff=${differenceBps.toFixed(2)} bps, Relative=${relativeIncrease.toFixed(2)}x, Absolute=${absoluteIncrease.toFixed(2)}pp, ` +
      `Gas=$${gasEstimate.toFixed(2)}, Break-even=${breakEvenTimeHours.toFixed(2)}h, Net gain=$${netGainUsd.toFixed(2)}`,
    );

    return {
      shouldTrigger,
      portfolioApy,
      opportunityApy,
      differenceBps,
      totalPortfolioValueUsd: totalAssetsUsd,
      yieldSummary,
      gasEstimate,
      breakEvenTimeHours,
      netGainUsd,
    };
  }

  /**
   * Convert strategy to target_positions format for calculate_rebalance_cost_batch
   */
  private convertStrategyToTargetPositions(
    strategy: any,
    lpSimulations: GetLpSimulateResponse[],
    supplyData: GetSupplyOpportunitiesResponse[],
    dexPools: Record<string, any>,
    chainId: string,
  ): { target_positions: { token: string; amount: string }[] } {
    const targetPositions: { token: string; amount: string }[] = [];

    if (!strategy || !strategy.positions || !Array.isArray(strategy.positions)) {
      return { target_positions: [] };
    }

    for (const position of strategy.positions) {
      if (position.type === 'supply') {
        // For supply positions, add the single token
        const tokenAddress = this.findTokenAddressForSupply(position.asset, supplyData, chainId);
        if (tokenAddress) {
          targetPositions.push({
            token: tokenAddress,
            amount: position.amount.toString(),
          });
        }
      } else if (position.type === 'lp') {
        // For LP positions, add both token0 and token1
        const lpInfo = this.findLpTokensFromSimulations(position.poolAddress, lpSimulations, dexPools);
        if (lpInfo) {
          if (lpInfo.token0Amount > 0) {
            targetPositions.push({
              token: lpInfo.token0Address,
              amount: lpInfo.token0Amount.toString(),
            });
          }
          if (lpInfo.token1Amount > 0) {
            targetPositions.push({
              token: lpInfo.token1Address,
              amount: lpInfo.token1Amount.toString(),
            });
          }
        }
      }
    }

    return { target_positions: targetPositions };
  }

  /**
   * Find token address for a supply position from supply opportunities data
   * Tries to get token address from:
   * 1. vault_address from supply opportunities
   * 2. lookupTokenAddress mapping
   * 3. Falls back to asset symbol
   */
  private findTokenAddressForSupply(
    assetSymbol: string,
    supplyData: GetSupplyOpportunitiesResponse[],
    chainId: string,
  ): string | null {
    // First try to find it in supply opportunities data
    for (const data of supplyData) {
      if (!data.opportunities || !Array.isArray(data.opportunities)) {
        continue;
      }

      for (const opp of data.opportunities) {
        if (opp.asset === assetSymbol) {
          // Use vault_address if available
          if (opp.vault_address) {
            return opp.vault_address;
          }
        }
      }
    }

    // If not found in opportunities, try to lookup by symbol
    const tokenAddress = lookupTokenAddress(assetSymbol, chainId);
    if (tokenAddress) {
      this.logger.log(`Resolved token address for ${assetSymbol} on chain ${chainId}: ${tokenAddress}`);
      return tokenAddress;
    }

    // Fall back to the symbol itself
    this.logger.warn(`Could not find token address for ${assetSymbol} on chain ${chainId}, using symbol as fallback`);
    return assetSymbol;
  }

  /**
   * Find LP token info from simulations and dexPools
   * Extract token amounts from simulation and token addresses from dexPools
   */
  private findLpTokensFromSimulations(
    poolAddress: string,
    lpSimulations: GetLpSimulateResponse[],
    dexPools: Record<string, any>,
  ): { token0Address: string; token1Address: string; token0Amount: number; token1Amount: number } | null {
    const normalizedPoolAddress = poolAddress.toLowerCase();

    // Find the simulation for this pool
    let token0Amount = 0;
    let token1Amount = 0;
    for (const sim of lpSimulations) {
      const simPoolAddress = sim.pool?.poolAddress?.toLowerCase();
      if (simPoolAddress === normalizedPoolAddress) {
        token0Amount = this.parseNumber(sim.summary?.requiredTokens?.token0?.amount) || 0;
        token1Amount = this.parseNumber(sim.summary?.requiredTokens?.token1?.amount) || 0;
        break;
      }
    }

    // Find token addresses from dexPools
    let token0Address = '';
    let token1Address = '';
    for (const [poolAddr, poolData] of Object.entries(dexPools)) {
      if (poolAddr.toLowerCase() === normalizedPoolAddress) {
        const currentSnapshot = poolData?.currentSnapshot || {};
        token0Address = currentSnapshot.token0Address || currentSnapshot.token0 || '';
        token1Address = currentSnapshot.token1Address || currentSnapshot.token1 || '';
        break;
      }
    }

    // Return null if we don't have the required data
    if (!token0Address || !token1Address || (token0Amount === 0 && token1Amount === 0)) {
      return null;
    }

    return {
      token0Address,
      token1Address,
      token0Amount,
      token1Amount,
    };
  }

  /**
   * Build all possible rebalancing strategies from available opportunities
   * Following the logic from buildBestOpportunityPrompt:
   * - Strategy A: 100% capital into best supply opportunity
   * - Strategy B: 100% capital into best LP opportunity
   * - Strategy C: 50% supply / 50% LP split (only if both exist)
   * Returns all strategies so they can be evaluated together by calculate_rebalance_cost_batch
   */
  private buildAllStrategies(
    lpSimulations: GetLpSimulateResponse[],
    supplyData: GetSupplyOpportunitiesResponse[],
    totalCapital: number,
    chainId: string,
  ): Array<{ name: string; apy: number; strategy: any }> {
    // Find best LP opportunity
    const bestLp = lpSimulations.reduce<{ apy: number; sim: GetLpSimulateResponse | null }>(
      (best, sim) => {
        const apy = this.extractLpApy(sim);
        return apy > best.apy ? { apy, sim } : best;
      },
      { apy: 0, sim: null },
    );

    // Find best supply opportunity
    const bestSupply = supplyData.reduce<{ apy: number; opp: any | null }>(
      (best, data) => {
        if (!data.opportunities || !Array.isArray(data.opportunities)) {
          return best;
        }

        for (const opp of data.opportunities) {
          const apy = this.parseNumber(opp.after?.supplyAPY) || 0;
          if (apy > best.apy) {
            return { apy, opp };
          }
        }
        return best;
      },
      { apy: 0, opp: null },
    );

    // Build all possible strategies
    const strategies: Array<{ name: string; apy: number; strategy: any }> = [];

    // Strategy A: 100% supply
    if (bestSupply.opp) {
      strategies.push({
        name: 'Strategy A: 100% Supply',
        apy: bestSupply.apy,
        strategy: {
          name: 'supply_100',
          positions: [
            {
              type: 'supply',
              protocol: this.normalizeProtocolName(bestSupply.opp.protocol || 'aave'),
              asset: bestSupply.opp.asset || bestSupply.opp.tokenSymbol,
              amount: totalCapital,
              allocation: 100,
            },
          ],
        },
      });
    }

    // Strategy B: 100% LP
    if (bestLp.sim) {
      strategies.push({
        name: 'Strategy B: 100% LP',
        apy: bestLp.apy,
        strategy: {
          name: 'lp_100',
          positions: [
            {
              type: 'lp',
              protocol: 'aerodromeSlipstream', // or extract from sim
              poolAddress: bestLp.sim.pool?.poolAddress || '',
              amount: totalCapital,
              allocation: 100,
            },
          ],
        },
      });
    }

    // Strategy C: 50% supply / 50% LP
    if (bestSupply.opp && bestLp.sim) {
      const combinedApy = (bestSupply.apy + bestLp.apy) / 2;
      strategies.push({
        name: 'Strategy C: 50% Supply + 50% LP',
        apy: combinedApy,
        strategy: {
          name: 'split_50_50',
          positions: [
            {
              type: 'supply',
              protocol: this.normalizeProtocolName(bestSupply.opp.protocol || 'aave'),
              asset: bestSupply.opp.asset || bestSupply.opp.tokenSymbol,
              amount: totalCapital * 0.5,
              allocation: 50,
            },
            {
              type: 'lp',
              protocol: 'aerodromeSlipstream',
              poolAddress: bestLp.sim.pool?.poolAddress || '',
              amount: totalCapital * 0.5,
              allocation: 50,
            },
          ],
        },
      });
    }

    return strategies;
  }

  private normalizeProtocolName(protocol: string): string {
    const protocolMap: Record<string, string> = {
      aerodromecl: 'aerodromeSlipstream',
      aerodrome: 'aerodromeSlipstream',
      uniswapv3: 'uniswapV3',
      aave: 'aave',
      euler: 'euler',
      venus: 'venus',
    };
    return protocolMap[protocol.toLowerCase()] || protocol;
  }

  private normalizeChainId(chain: string): string {
    const map: Record<string, string> = {
      base: '8453',
      ethereum: '1',
      eth: '1',
      mainnet: '1',
      arbitrum: '42161',
      optimism: '10',
      polygon: '137',
      bsc: '56',
      avalanche: '43114',
    };

    if (!chain) {
      return '';
    }

    const normalized = map[chain.toLowerCase()];
    return normalized || chain;
  }

  private buildLpSimulateRequests(
    chainId: ChainId,
    dexPools: Record<string, any> | null | undefined,
    amount: number,
  ): GetLpSimulateRequest[] {
    if (!dexPools || typeof dexPools !== 'object') {
      return [];
    }

    const requests: GetLpSimulateRequest[] = [];
    const notional = Math.max(amount, this.lpSimulationAmountUsd);

    for (const [poolAddress, poolData] of Object.entries(dexPools)) {
      const currentTickValue =
        this.parseNumber(poolData?.currentSnapshot?.currentTick) ??
        this.parseNumber(poolData?.pricePosition?.currentTick) ??
        this.parseNumber((poolData as any)?.currentTick);

      if (currentTickValue === null || !Number.isFinite(currentTickValue)) {
        continue;
      }

      const tickLower = Math.trunc(currentTickValue);
      const tickUpper = tickLower + 1;

      const request: GetLpSimulateRequest = {
        chain_id: chainId,
        poolOperation: {
          poolAddress,
          operation: 'add',
          amountUSD: notional,
          tickLower,
          tickUpper,
          timeHorizon: this.lpSimulationTimeHorizonMinutes,
        },
        priceImpact: false,
        includeIL: true,
      };

      requests.push(request);
    }

    return requests;
  }

  private calculateOpportunityApy(
    lpSimulations: GetLpSimulateResponse[],
    supplyData: GetSupplyOpportunitiesResponse[],
  ): number {
    const maxLpApy = lpSimulations.reduce(
      (currentMax, simulation) => Math.max(currentMax, this.extractLpApy(simulation)),
      0,
    );

    const maxSupplyApy = supplyData.reduce(
      (currentMax, data) => Math.max(currentMax, this.extractMaxApy(data)),
      0,
    );

    return Math.max(maxLpApy, maxSupplyApy);
  }

  private extractLpApy(simulation: GetLpSimulateResponse | null | undefined): number {
    if (!simulation) {
      return 0;
    }

    const candidateValues = [
      this.parseNumber(simulation.pool?.after?.estimatedAPY),
      this.parseNumber((simulation.pool?.after as any)?.afterAPY),
      this.parseNumber((simulation as any)?.afterAPY),
      this.parseNumber(simulation.summary?.totalExpectedAPY),
      this.parseNumber(simulation.pool?.before?.apy),
    ];

    for (const candidate of candidateValues) {
      if (candidate !== null) {
        return candidate;
      }
    }

    return 0;
  }

  private extractMaxApy(data: GetSupplyOpportunitiesResponse): number {
    let maxApy = 0;

    // Extract supplyAPY from after field in opportunities
    if (data.opportunities && Array.isArray(data.opportunities)) {
      for (const opportunity of data.opportunities) {
        if (opportunity.after && typeof opportunity.after.supplyAPY === 'number') {
          maxApy = Math.max(maxApy, opportunity.after.supplyAPY);
        }
      }
    }

    return maxApy;
  }

  private normalizeDictionaryResponse<T>(data: any): T[] {
    if (!data) {
      return [];
    }

    if (Array.isArray(data)) {
      return data as T[];
    }

    if (typeof data === 'object') {
      const entries = Object.entries(data).filter(([key]) => key !== '_dataSource');

      if (entries.length === 0) {
        return [];
      }

      entries.sort((a, b) => {
        const aNum = Number(a[0]);
        const bNum = Number(b[0]);

        const aIsNum = !Number.isNaN(aNum);
        const bIsNum = !Number.isNaN(bNum);

        if (aIsNum && bIsNum) {
          return aNum - bNum;
        }
        if (aIsNum) {
          return -1;
        }
        if (bIsNum) {
          return 1;
        }
        return a[0].localeCompare(b[0]);
      });

      return entries.map(([, value]) => value as T);
    }

    return [];
  }

  private findNumberDirect(source: any, keys: string[]): number | null {
    if (!source || typeof source !== 'object') {
      return null;
    }

    for (const key of keys) {
      if (key in source) {
        const parsed = this.parseNumber((source as Record<string, any>)[key]);
        if (parsed !== null) {
          return parsed;
        }
      }
    }
    return null;
  }

  private parseNumber(value: any): number | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === 'string') {
      const sanitized = value.replace(/[%,$]/g, '').trim();
      const parsed = Number(sanitized);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private walkStructure(value: any, visitor: (node: any) => void): void {
    const stack: any[] = [value];
    const seen = new Set<any>();

    while (stack.length > 0) {
      const current = stack.pop();
      if (current === null || current === undefined) {
        continue;
      }
      if (typeof current !== 'object') {
        continue;
      }
      if (seen.has(current)) {
        continue;
      }

      seen.add(current);
      visitor(current);

      if (Array.isArray(current)) {
        for (const item of current) {
          stack.push(item);
        }
      } else {
        for (const value of Object.values(current)) {
          stack.push(value);
        }
      }
    }
  }
}
