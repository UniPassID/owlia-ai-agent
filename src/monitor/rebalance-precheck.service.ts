import { Injectable, Logger } from "@nestjs/common";
import { AgentService } from "../agent/agent.service";
import {
  AccountYieldSummaryResponse,
  CalculateRebalanceCostBatchRequest,
  CalculateRebalanceCostBatchResponse,
  CalculateRebalanceCostResult,
  ChainId,
  GetDexPoolsResponse,
  GetLpSimulateRequest,
  GetLpSimulateResponse,
  GetSupplyOpportunitiesResponse,
  LendingPosition,
  ProtocolType,
  RebalanceRoute,
  TargetLiquidityPosition,
} from "../agent/types/mcp.types";
import {
  lookupTokenAddress,
  lookupTokenSymbol,
  TOKEN_DECIMALS_BY_CHAIN,
} from "../agent/token-utils";
import { MarginalOptimizerService } from "./portfolio-optimizer/marginal-optimizer.service";
import { OpportunityConverterService } from "./portfolio-optimizer/opportunity-converter.service";
import { LENDING_PROTOCOLS } from "../config/protocol.config";
import { UserV2 } from "../entities/user-v2.entity";
import { UserV2Deployment } from "../entities/user-v2-deployment.entity";
import { hexlify } from "ethers";

export interface StrategyPosition {
  type: "supply" | "lp";
  protocol: string;
  amount: number;
  allocation: number;
  // Supply fields
  asset?: string;
  vaultAddress?: string;
  // LP fields
  poolAddress?: string;
  token0Address?: string;
  token1Address?: string;
  token0Amount?: number;
  token1Amount?: number;
  tickLower?: number;
  tickUpper?: number;
}

export interface Strategy {
  name: string;
  positions: StrategyPosition[];
  metadata: {
    totalInvested: number;
    totalSwapCost: number;
    allocationHistory: any[];
  };
  allocations?: Record<string, number>;
}

export interface StrategyCandidate {
  name: string;
  apy: number;
  strategy: Strategy;
}

export interface StrategyEvaluationRecord {
  strategyIndex: number;
  strategyName: string;
  strategyApy: number;
  portfolioApy: number;

  // Cost analysis
  swapFee: number;

  // Return analysis
  apyImprovement: number;
  annualGainUsd: number;
  dailyGainUsd: number;
  dailyCostUsd: number;
  netDailyGainUsd: number;

  // Time metrics
  breakEvenTimeHours: number;

  // Selection score
  score: number;

  // Constraint checks
  meetsBreakEvenConstraint: boolean;
  meetsRelativeApyConstraint: boolean;
  meetsAbsoluteApyConstraint: boolean;

  // Selection status
  isSelected: boolean;

  // Strategy details
  positions: StrategyPosition[];
  totalInvested: number;
  totalSwapCost: number;
}

export enum PositionStatus {
  LP_IN_RANGE = "LP_IN_RANGE", // LP position exists and is in range
  LP_OUT_OF_RANGE = "LP_OUT_OF_RANGE", // LP position exists but is out of range
  LENDING_ONLY = "LENDING_ONLY", // Only lending positions, no LP
  NO_POSITION = "NO_POSITION", // No active positions
}

export interface RebalanceConstraints {
  maxBreakEvenHours: number;
  minRelativeApyIncrease: number; // e.g., 1.1 means 10% increase
  minAbsoluteApyIncrease: number; // in percentage points
}

export interface RebalancePrecheckResult {
  shouldTrigger: boolean;
  portfolioApy: number;
  opportunityApy: number;
  differenceBps: number;
  totalPortfolioValueUsd: number;
  yieldSummary?: AccountYieldSummaryResponse;
  currentHoldings?: Record<string, number>;
  gasEstimate?: number;
  breakEvenTimeHours?: number;
  netGainUsd?: number;
  failureReason?: string;
  bestStrategy?: StrategyCandidate;
  strategyEvaluations?: StrategyEvaluationRecord[];
}

@Injectable()
export class RebalancePrecheckService {
  private readonly logger = new Logger(RebalancePrecheckService.name);
  private readonly lpSimulationTimeHorizonMinutes = 30;
  private _cachedLpSimulations: GetLpSimulateResponse[] = [];
  private _cachedDexPools: Record<string, any> = {};

  constructor(
    private readonly agentService: AgentService,
    private readonly marginalOptimizer: MarginalOptimizerService,
    private readonly opportunityConverter: OpportunityConverterService
  ) {}

  async evaluate(
    deployment: UserV2Deployment
  ): Promise<RebalancePrecheckResult> {
    const chainId = deployment.chainId.toString() as ChainId;

    // Fetch data
    const { yieldSummary, totalAssetsUsd, portfolioApy, currentHoldings } =
      await this.fetchUserData(deployment, chainId);

    if (!yieldSummary || totalAssetsUsd < 50) {
      return this.rejectResult(portfolioApy, totalAssetsUsd, yieldSummary);
    }

    const { lpSimulations, supplyOpportunities, dexPools } =
      await this.fetchOpportunities(deployment, chainId, totalAssetsUsd);

    // Determine current position status to apply appropriate constraints
    const positionStatus = this.determinePositionStatus(yieldSummary, dexPools);
    this.logger.log(
      `Position status for user ${deployment.userId}: ${positionStatus}`
    );

    // Build optimized strategies
    const allStrategies = await this.buildOptimizedStrategies(
      lpSimulations,
      supplyOpportunities,
      totalAssetsUsd,
      chainId,
      dexPools,
      hexlify(deployment.address),
      currentHoldings
    );

    if (allStrategies.length === 0) {
      return this.rejectResult(
        portfolioApy,
        totalAssetsUsd,
        yieldSummary,
        "No valid strategies"
      );
    }

    this.logger.log(
      `Built ${allStrategies.length} strategies for user ${deployment.userId}`
    );

    // Evaluate strategies with cost analysis
    const {
      bestStrategy,
      gasEstimate,
      breakEvenTimeHours,
      netGainUsd,
      evaluationRecords,
    } = await this.evaluateStrategies(
      allStrategies,
      hexlify(deployment.address),
      chainId,
      lpSimulations,
      supplyOpportunities,
      dexPools,
      totalAssetsUsd,
      portfolioApy,
      positionStatus
    );

    // // Check if any strategy meets constraints
    // if (breakEvenTimeHours < 0) {
    //   return {
    //     shouldTrigger: false,
    //     portfolioApy,
    //     opportunityApy: bestStrategy.apy,
    //     differenceBps: (bestStrategy.apy - portfolioApy) * 100,
    //     totalPortfolioValueUsd: totalAssetsUsd,
    //     yieldSummary,
    //     currentHoldings,
    //     failureReason: 'No strategy meets breakeven time constraint (all > 4h)',
    //   };
    // }

    // Check remaining constraints
    return this.checkConstraintsAndDecide(
      bestStrategy,
      portfolioApy,
      totalAssetsUsd,
      yieldSummary,
      currentHoldings,
      gasEstimate,
      breakEvenTimeHours,
      netGainUsd,
      deployment.userId,
      positionStatus,
      evaluationRecords
    );
  }

  private async fetchUserData(deployment: UserV2Deployment, chainId: ChainId) {
    try {
      const yieldSummary =
        await this.agentService.callMcpTool<AccountYieldSummaryResponse>(
          "get_account_yield_summary",
          { wallet_address: hexlify(deployment.address), chain_id: chainId }
        );

      const totalAssetsUsd = this.parseNumber(yieldSummary.totalAssetsUsd) || 0;
      const portfolioApy = this.parseNumber(yieldSummary.portfolioApy) || 0;

      // Extract current token holdings from positions
      const currentHoldings = this.extractCurrentHoldings(yieldSummary);

      this.logger.log(
        `Portfolio for user ${deployment.userId}: totalAssets=$${totalAssetsUsd}, APY=${portfolioApy}%, ` +
          `holdings=${JSON.stringify(currentHoldings)}, ` +
          `yieldSummary=${JSON.stringify(yieldSummary)}`
      );

      return { yieldSummary, totalAssetsUsd, portfolioApy, currentHoldings };
    } catch (error) {
      this.logger.warn(`get_account_yield_summary failed: ${error.message}`);
      return {
        yieldSummary: null,
        totalAssetsUsd: 0,
        portfolioApy: 0,
        currentHoldings: {},
      };
    }
  }

  /**
   * Determine the current position status based on active investments
   * Used to apply different rebalancing constraints
   */
  private determinePositionStatus(
    yieldSummary: AccountYieldSummaryResponse | null,
    dexPools: Record<string, any>
  ): PositionStatus {
    if (!yieldSummary?.activeInvestments) {
      return PositionStatus.NO_POSITION;
    }

    const { activeInvestments } = yieldSummary;
    let hasLpPosition = false;
    let hasInRangeLp = false;
    let hasLendingPosition = false;

    // Check Uniswap V3 LP positions
    if (activeInvestments.uniswapV3LiquidityInvestments?.positions) {
      for (const liquidityPosition of activeInvestments
        .uniswapV3LiquidityInvestments.positions) {
        for (const protocolPosition of liquidityPosition.protocolPositions ||
          []) {
          for (const deposit of protocolPosition.deposits || []) {
            const extraData = deposit.extraData;
            if (extraData) {
              hasLpPosition = true;

              // Get pool address to look up current tick from dexPools
              const poolAddress = protocolPosition.poolInfo?.poolAddress;
              if (!poolAddress) continue;

              // Get current tick from dexPools
              const poolData = dexPools[poolAddress.toLowerCase()];
              const currentTick =
                this.parseNumber(poolData?.pricePosition?.currentTick) ??
                this.parseNumber(poolData?.currentSnapshot?.currentTick);

              const tickLower = this.parseNumber(extraData.tickLower);
              const tickUpper = this.parseNumber(extraData.tickUpper);

              if (
                currentTick !== null &&
                tickLower !== null &&
                tickUpper !== null
              ) {
                if (currentTick >= tickLower && currentTick <= tickUpper) {
                  hasInRangeLp = true;
                  break;
                }
              }
            }
          }
          if (hasInRangeLp) break;
        }
        if (hasInRangeLp) break;
      }
    }

    // Check Aerodrome Slipstream LP positions
    if (
      !hasInRangeLp &&
      activeInvestments.aerodromeSlipstreamLiquidityInvestments?.positions
    ) {
      for (const liquidityPosition of activeInvestments
        .aerodromeSlipstreamLiquidityInvestments.positions) {
        for (const protocolPosition of liquidityPosition.protocolPositions ||
          []) {
          for (const deposit of protocolPosition.deposits || []) {
            const extraData = deposit.extraData;
            if (extraData) {
              hasLpPosition = true;

              // Get pool address to look up current tick from dexPools
              const poolAddress = protocolPosition.poolInfo?.poolAddress;
              if (!poolAddress) continue;

              // Get current tick from dexPools
              const poolData = dexPools[poolAddress.toLowerCase()];
              const currentTick =
                this.parseNumber(poolData?.pricePosition?.currentTick) ??
                this.parseNumber(poolData?.currentSnapshot?.currentTick);

              const tickLower = this.parseNumber(extraData.tickLower);
              const tickUpper = this.parseNumber(extraData.tickUpper);

              if (
                currentTick !== null &&
                tickLower !== null &&
                tickUpper !== null
              ) {
                if (currentTick >= tickLower && currentTick <= tickUpper) {
                  hasInRangeLp = true;
                  break;
                }
              }
            }
          }
          if (hasInRangeLp) break;
        }
        if (hasInRangeLp) break;
      }
    }

    // Check Lending positions
    if (activeInvestments.lendingInvestments?.positions) {
      for (const lendingPosition of activeInvestments.lendingInvestments
        .positions) {
        const supplies = lendingPosition.protocolPositions?.supplies || [];
        if (supplies.length > 0) {
          hasLendingPosition = true;
          break;
        }
      }
    }

    // Determine status based on positions
    if (hasInRangeLp) {
      return PositionStatus.LP_IN_RANGE;
    } else if (hasLpPosition) {
      return PositionStatus.LP_OUT_OF_RANGE;
    } else if (hasLendingPosition) {
      return PositionStatus.LENDING_ONLY;
    } else {
      return PositionStatus.NO_POSITION;
    }
  }

  /**
   * Get rebalancing constraints based on current position status
   */
  private getConstraintsByPositionStatus(
    status: PositionStatus
  ): RebalanceConstraints {
    switch (status) {
      case PositionStatus.LP_IN_RANGE:
        // Very strict constraints: only rebalance for "super high APY" opportunities
        return {
          maxBreakEvenHours: 2,
          minRelativeApyIncrease: 1.0, // Not used for LP_IN_RANGE
          minAbsoluteApyIncrease: 20, // 20 percentage points
        };

      case PositionStatus.LP_OUT_OF_RANGE:
      case PositionStatus.LENDING_ONLY:
      case PositionStatus.NO_POSITION:
      default:
        // Standard constraints: find best APY opportunities
        return {
          maxBreakEvenHours: 4,
          minRelativeApyIncrease: 1.1, // 10% relative increase
          minAbsoluteApyIncrease: 2, // 2 percentage points
        };
    }
  }

  /**
   * Extract current token holdings from yield summary
   * Returns a map of token symbol to amount
   */
  private extractCurrentHoldings(
    yieldSummary: AccountYieldSummaryResponse
  ): Record<string, number> {
    const holdings: Record<string, number> = {};

    // 1. Extract from idle assets
    if (yieldSummary.idleAssets?.assets) {
      for (const asset of yieldSummary.idleAssets.assets) {
        const amount = this.parseNumber(asset.balance) || 0;
        if (amount > 0) {
          const key = asset.tokenSymbol;
          holdings[key] = (holdings[key] || 0) + amount;
        }
      }
    }

    // 2. Extract from lending positions (supply only)
    if (yieldSummary.activeInvestments?.lendingInvestments?.positions) {
      for (const lendingPosition of yieldSummary.activeInvestments
        .lendingInvestments.positions) {
        // Each position has protocolPositions with supplies array
        const supplies = lendingPosition.protocolPositions?.supplies || [];

        for (const supply of supplies) {
          const amount = this.parseNumber(supply.supplyAmount) || 0;
          if (amount > 0) {
            const key = supply.tokenSymbol;
            holdings[key] = (holdings[key] || 0) + amount;
          }
        }
      }
    }

    // 3. Extract from Uniswap V3 LP positions
    if (
      yieldSummary.activeInvestments?.uniswapV3LiquidityInvestments?.positions
    ) {
      for (const liquidityPosition of yieldSummary.activeInvestments
        .uniswapV3LiquidityInvestments.positions) {
        // Each position has protocolPositions array
        for (const protocolPosition of liquidityPosition.protocolPositions ||
          []) {
          // Get token symbols from poolInfo as fallback
          const poolTokens = protocolPosition.poolInfo?.tokens || [];
          const token0SymbolFallback = poolTokens[0]?.symbol;
          const token1SymbolFallback = poolTokens[1]?.symbol;

          // Each protocolPosition has deposits array
          for (const deposit of protocolPosition.deposits || []) {
            const extraData = deposit.extraData;
            if (extraData) {
              // Extract token0
              const token0Amount =
                this.parseNumber(extraData.token0Amount) || 0;
              if (token0Amount > 0) {
                const token0Symbol = extraData.token0 || token0SymbolFallback;
                if (token0Symbol) {
                  holdings[token0Symbol] =
                    (holdings[token0Symbol] || 0) + token0Amount;
                }
              }

              // Extract token1
              const token1Amount =
                this.parseNumber(extraData.token1Amount) || 0;
              if (token1Amount > 0) {
                const token1Symbol = extraData.token1 || token1SymbolFallback;
                if (token1Symbol) {
                  holdings[token1Symbol] =
                    (holdings[token1Symbol] || 0) + token1Amount;
                }
              }
            }
          }
        }
      }
    }

    // 4. Extract from Aerodrome Slipstream LP positions
    if (
      yieldSummary.activeInvestments?.aerodromeSlipstreamLiquidityInvestments
        ?.positions
    ) {
      for (const liquidityPosition of yieldSummary.activeInvestments
        .aerodromeSlipstreamLiquidityInvestments.positions) {
        for (const protocolPosition of liquidityPosition.protocolPositions ||
          []) {
          // Get token symbols from poolInfo as fallback
          const poolTokens = protocolPosition.poolInfo?.tokens || [];
          const token0SymbolFallback = poolTokens[0]?.symbol;
          const token1SymbolFallback = poolTokens[1]?.symbol;

          for (const deposit of protocolPosition.deposits || []) {
            const extraData = deposit.extraData;
            if (extraData) {
              // Extract token0
              const token0Amount =
                this.parseNumber(extraData.token0Amount) || 0;
              if (token0Amount > 0) {
                const token0Symbol = extraData.token0 || token0SymbolFallback;
                if (token0Symbol) {
                  holdings[token0Symbol] =
                    (holdings[token0Symbol] || 0) + token0Amount;
                }
              }

              // Extract token1
              const token1Amount =
                this.parseNumber(extraData.token1Amount) || 0;
              if (token1Amount > 0) {
                const token1Symbol = extraData.token1 || token1SymbolFallback;
                if (token1Symbol) {
                  holdings[token1Symbol] =
                    (holdings[token1Symbol] || 0) + token1Amount;
                }
              }
            }
          }
        }
      }
    }

    return holdings;
  }

  private async fetchOpportunities(
    deployment: UserV2Deployment,
    chainId: ChainId,
    totalAssetsUsd: number
  ) {
    const lpSimulations: GetLpSimulateResponse[] = [];
    const supplyOpportunities: GetSupplyOpportunitiesResponse[] = [];
    let dexPools: GetDexPoolsResponse = {};

    try {
      dexPools = await this.agentService.callMcpTool<GetDexPoolsResponse>(
        "get_dex_pools",
        {
          chain_id: chainId,
        }
      );
      this.logger.log(`get_dex_pools response: ${JSON.stringify(dexPools)}`);

      const lpRequests = this.buildLpSimulateRequests(
        chainId,
        dexPools,
        totalAssetsUsd
      );
      if (lpRequests.length > 0) {
        const simulationsRaw = await this.agentService.callMcpTool<any>(
          "get_lp_simulate_batch",
          {
            reqs: lpRequests,
          }
        );
        this.logger.log(
          `get_lp_simulate_batch response: ${JSON.stringify(simulationsRaw)}`
        );
        const simulations =
          this.normalizeDictionaryResponse<GetLpSimulateResponse>(
            simulationsRaw
          );
        lpSimulations.push(...simulations);
      }
    } catch (error) {
      this.logger.warn(`LP simulation failed: ${error.message}`);
    }

    try {
      const supplyOpps =
        await this.agentService.callMcpTool<GetSupplyOpportunitiesResponse>(
          "get_supply_opportunities",
          {
            chain_id: chainId,
            amount: totalAssetsUsd,
            protocols: [...LENDING_PROTOCOLS],
          }
        );
      this.logger.log(
        `get_supply_opportunities response: ${JSON.stringify(supplyOpps)}`
      );
      supplyOpportunities.push(supplyOpps);
    } catch (error) {
      this.logger.warn(`get_supply_opportunities failed: ${error.message}`);
    }

    return { lpSimulations, supplyOpportunities, dexPools };
  }

  private async buildOptimizedStrategies(
    lpSimulations: GetLpSimulateResponse[],
    supplyData: GetSupplyOpportunitiesResponse[],
    totalCapital: number,
    chainId: string,
    dexPools: Record<string, any>,
    walletAddress: string,
    currentHoldings: Record<string, number>
  ): Promise<StrategyCandidate[]> {
    // Store these for later use in strategy position enrichment
    this._cachedLpSimulations = lpSimulations;
    this._cachedDexPools = dexPools;
    const opportunities = this.opportunityConverter.convertToOpportunities(
      lpSimulations,
      supplyData,
      totalCapital,
      chainId,
      dexPools
    );

    if (opportunities.length === 0) return [];

    this.logger.log(
      `Found ${opportunities.length} opportunities for optimization`
    );

    const optimizationConfigs = [
      // {
      //   name: 'Aggressive',
      //   incrementSize: Math.max(totalCapital * 0.15, 50),
      //   minMarginalAPY: 8,
      //   maxBreakevenHours: 2,
      //   holdingPeriodDays: 1,
      // },
      // {
      //   name: 'Balanced',
      //   incrementSize: Math.max(totalCapital * 0.30, 100),
      //   minMarginalAPY: 5,
      //   maxBreakevenHours: 4,
      //   holdingPeriodDays: 1,
      // },
      {
        name: "Conservative",
        incrementSize: Math.max(totalCapital * 0.5, 100),
        minMarginalAPY: 3,
        maxBreakevenHours: 8,
        holdingPeriodDays: 1,
      },
    ];

    const strategies: StrategyCandidate[] = [];

    for (const config of optimizationConfigs) {
      try {
        const result = await this.marginalOptimizer.optimizePortfolio(
          opportunities,
          totalCapital,
          config,
          walletAddress,
          chainId,
          currentHoldings,
          lpSimulations,
          supplyData,
          dexPools,
          true,
          true
        );

        if (result.positions.length === 0) continue;

        const strategyPositions = result.positions.map((pos) => {
          const basePosition = {
            type: pos.opportunity.type,
            protocol: pos.opportunity.protocol,
            amount: pos.amount,
            allocation: (pos.amount / result.totalInvested) * 100,
          };

          if (pos.opportunity.type === "supply") {
            return {
              ...basePosition,
              asset: pos.opportunity.asset,
              vaultAddress: pos.opportunity.vaultAddress,
            };
          } else if (pos.opportunity.type === "lp") {
            // Enrich LP position with token addresses, amounts, and ticks
            const lpInfo = this.findLpPositionInfo(
              pos.opportunity.poolAddress,
              this._cachedLpSimulations,
              this._cachedDexPools
            );

            return {
              ...basePosition,
              poolAddress: pos.opportunity.poolAddress,
              token0Address: lpInfo?.token0Address,
              token1Address: lpInfo?.token1Address,
              token0Amount: lpInfo?.token0Amount,
              token1Amount: lpInfo?.token1Amount,
              tickLower: lpInfo?.tickLower,
              tickUpper: lpInfo?.tickUpper,
            };
          }

          return basePosition;
        });

        strategies.push({
          name: `Strategy ${config.name}: Marginal Optimized`,
          apy: result.weightedAPY,
          strategy: {
            name: `marginal_${config.name.toLowerCase()}`,
            positions: strategyPositions,
            metadata: {
              totalInvested: result.totalInvested,
              totalSwapCost: result.totalSwapCost,
              allocationHistory: result.allocationHistory,
            },
          },
        });
      } catch (error) {
        this.logger.warn(
          `Failed to run ${config.name} optimization: ${error.message}`
        );
      }
    }

    return strategies;
  }

  private async evaluateStrategies(
    allStrategies: StrategyCandidate[],
    walletAddress: string,
    chainId: ChainId,
    lpSimulations: GetLpSimulateResponse[],
    supplyData: GetSupplyOpportunitiesResponse[],
    dexPools: Record<string, any>,
    totalAssetsUsd: number,
    portfolioApy: number,
    positionStatus: PositionStatus
  ) {
    const constraints = this.getConstraintsByPositionStatus(positionStatus);
    const maxBreakEvenHours = constraints.maxBreakEvenHours;
    const minRelativeApyIncrease = constraints.minRelativeApyIncrease;
    const minAbsoluteApyIncrease = constraints.minAbsoluteApyIncrease;

    this.logger.log(
      `Evaluating strategies with constraints for ${positionStatus}: ` +
        `maxBreakEvenHours=${maxBreakEvenHours}h, ` +
        `minRelativeApyIncrease=${minRelativeApyIncrease}x, ` +
        `minAbsoluteApyIncrease=${minAbsoluteApyIncrease}pp`
    );

    let gasEstimate = 0;
    let breakEvenTimeHours = 0;
    let netGainUsd = 0;
    let bestStrategy = allStrategies[0];
    const evaluationRecords: StrategyEvaluationRecord[] = [];

    try {
      const targetPositionsBatch = allStrategies.map((s) =>
        this.convertStrategyToTargetPositions(
          s.strategy,
          lpSimulations,
          supplyData,
          dexPools,
          chainId
        )
      );

      const request: CalculateRebalanceCostBatchRequest = {
        safeAddress: walletAddress,
        wallet_address: walletAddress,
        chain_id: chainId,
        target_positions_batch: targetPositionsBatch,
      };

      const costResult =
        await this.agentService.callMcpTool<CalculateRebalanceCostBatchResponse>(
          "calculate_rebalance_cost_batch",
          request
        );

      this.logger.log(
        `calculate_rebalance_cost_batch response: ${JSON.stringify(costResult)}`
      );

      const resultsArray =
        this.normalizeDictionaryResponse<CalculateRebalanceCostResult>(
          costResult
        );

      let bestScore = -Infinity;
      let bestStrategyIndex = -1;

      resultsArray.forEach((result, index) => {
        if (index >= allStrategies.length) return;

        this.logRebalanceSwapPlan(result, chainId, index);

        const swapFee = this.parseNumber(result.fee) || 0;
        const strategyApy = allStrategies[index].apy;
        const apyImprovement = strategyApy - portfolioApy;

        let breakEven = 0;
        let annualGain = 0;
        if (apyImprovement > 0 && totalAssetsUsd > 0) {
          annualGain = (totalAssetsUsd * apyImprovement) / 100;
          if (annualGain > 0) {
            breakEven = (swapFee / annualGain) * 365 * 24;
          }
        }

        const dailyGainRate = apyImprovement / 100 / 365;
        const dailyGain = totalAssetsUsd * dailyGainRate;
        const dailyCost = swapFee / 30;
        const netGain = dailyGain - dailyCost;

        const score = netGain / (breakEven + 1);

        const relativeIncrease =
          portfolioApy > 0 ? strategyApy / portfolioApy : Infinity;
        const meetsBreakEvenConstraint = breakEven <= maxBreakEvenHours;
        const meetsRelativeApyConstraint =
          relativeIncrease >= minRelativeApyIncrease;
        const meetsAbsoluteApyConstraint =
          apyImprovement >= minAbsoluteApyIncrease;

        this.logger.log(
          `Strategy ${index} (${allStrategies[index].name}): ` +
            `APY=${strategyApy.toFixed(2)}%, swap_fee=$${swapFee.toFixed(4)}, ` +
            `break-even=${breakEven.toFixed(2)}h, score=${score.toFixed(4)}`
        );

        // Record evaluation data
        evaluationRecords.push({
          strategyIndex: index,
          strategyName: allStrategies[index].name,
          strategyApy,
          portfolioApy,
          swapFee,
          apyImprovement,
          annualGainUsd: annualGain,
          dailyGainUsd: dailyGain,
          dailyCostUsd: dailyCost,
          netDailyGainUsd: netGain,
          breakEvenTimeHours: breakEven,
          score,
          meetsBreakEvenConstraint,
          meetsRelativeApyConstraint,
          meetsAbsoluteApyConstraint,
          isSelected: false, // Will update later
          positions: allStrategies[index].strategy.positions,
          totalInvested: allStrategies[index].strategy.metadata.totalInvested,
          totalSwapCost: allStrategies[index].strategy.metadata.totalSwapCost,
        });

        // Only consider strategies that meet breakeven constraint
        if (breakEven <= maxBreakEvenHours && score > bestScore) {
          bestScore = score;
          bestStrategyIndex = index;
          gasEstimate = swapFee;
          breakEvenTimeHours = breakEven;
          netGainUsd = netGain;
          bestStrategy = allStrategies[index];
        }
      });

      // Mark the selected strategy
      if (bestStrategyIndex !== -1) {
        evaluationRecords[bestStrategyIndex].isSelected = true;
      }

      // If no strategy meets the constraint, return with negative marker
      if (bestStrategyIndex === -1) {
        this.logger.log(
          `No strategy meets breakeven time constraint (all > ${maxBreakEvenHours}h)`
        );
        return {
          bestStrategy: allStrategies[0],
          gasEstimate: 0,
          breakEvenTimeHours: -1,
          netGainUsd: 0,
          evaluationRecords,
        };
      }
    } catch (error) {
      this.logger.warn(`Cost calculation failed: ${error.message}`);
    }

    return {
      bestStrategy,
      gasEstimate,
      breakEvenTimeHours,
      netGainUsd,
      evaluationRecords,
    };
  }

  private checkConstraintsAndDecide(
    bestStrategy: StrategyCandidate,
    portfolioApy: number,
    totalAssetsUsd: number,
    yieldSummary: AccountYieldSummaryResponse,
    currentHoldings: Record<string, number>,
    gasEstimate: number,
    breakEvenTimeHours: number,
    netGainUsd: number,
    userId: string,
    positionStatus: PositionStatus,
    evaluationRecords?: StrategyEvaluationRecord[]
  ): RebalancePrecheckResult {
    const opportunityApy = bestStrategy.apy;
    const relativeIncrease =
      portfolioApy > 0 ? opportunityApy / portfolioApy : Infinity;
    const absoluteIncrease = opportunityApy - portfolioApy;

    const constraints = this.getConstraintsByPositionStatus(positionStatus);

    // Note: breakEvenTimeHours constraint is already checked in evaluateStrategies()

    // For LP_IN_RANGE, only check absolute APY increase (20pp)
    // For other statuses, check both relative (10%) and absolute (2pp) increase
    let meetsApyConstraint = false;

    if (positionStatus === PositionStatus.LP_IN_RANGE) {
      meetsApyConstraint =
        absoluteIncrease >= constraints.minAbsoluteApyIncrease;
    } else {
      meetsApyConstraint =
        relativeIncrease >= constraints.minRelativeApyIncrease &&
        absoluteIncrease >= constraints.minAbsoluteApyIncrease;
    }

    if (!meetsApyConstraint) {
      this.logger.log(
        `Precheck REJECTED (${positionStatus}): APY conditions not met. ` +
          `Relative=${relativeIncrease.toFixed(2)}x, Absolute=${absoluteIncrease.toFixed(2)}pp, ` +
          `Required: relative>=${constraints.minRelativeApyIncrease}x, absolute>=${constraints.minAbsoluteApyIncrease}pp`
      );
      return {
        shouldTrigger: false,
        portfolioApy,
        opportunityApy,
        differenceBps: (opportunityApy - portfolioApy) * 100,
        totalPortfolioValueUsd: totalAssetsUsd,
        yieldSummary,
        currentHoldings,
        gasEstimate,
        breakEvenTimeHours,
        netGainUsd,
        failureReason: `APY improvement insufficient for ${positionStatus}`,
        strategyEvaluations: evaluationRecords,
      };
    }

    const strategyDetails = this.formatStrategyDetails(bestStrategy.strategy);
    this.logger.log(
      `Precheck APPROVED for user ${userId}: ` +
        `Portfolio APY=${portfolioApy.toFixed(2)}%, Opportunity APY=${opportunityApy.toFixed(2)}%, ` +
        `Strategy=${bestStrategy.name}, ${strategyDetails}`
    );

    return {
      shouldTrigger: true,
      portfolioApy,
      opportunityApy,
      differenceBps: (opportunityApy - portfolioApy) * 100,
      totalPortfolioValueUsd: totalAssetsUsd,
      yieldSummary,
      currentHoldings,
      gasEstimate,
      breakEvenTimeHours,
      netGainUsd,
      bestStrategy,
      strategyEvaluations: evaluationRecords,
    };
  }

  private rejectResult(
    portfolioApy: number,
    totalAssetsUsd: number,
    yieldSummary?: AccountYieldSummaryResponse,
    reason?: string,
    currentHoldings?: Record<string, number>
  ): RebalancePrecheckResult {
    return {
      shouldTrigger: false,
      portfolioApy,
      opportunityApy: 0,
      differenceBps: 0,
      totalPortfolioValueUsd: totalAssetsUsd,
      yieldSummary,
      currentHoldings,
      failureReason: reason,
    };
  }

  // Helper methods (simplified versions)

  private buildLpSimulateRequests(
    chainId: ChainId,
    dexPools: Record<string, any> | null | undefined,
    amount: number
  ): GetLpSimulateRequest[] {
    if (!dexPools || typeof dexPools !== "object") return [];

    const requests: GetLpSimulateRequest[] = [];

    for (const [poolAddress, poolData] of Object.entries(dexPools)) {
      const currentTickValue =
        this.parseNumber(poolData?.currentSnapshot?.currentTick) ??
        this.parseNumber(poolData?.pricePosition?.currentTick) ??
        this.parseNumber((poolData as any)?.currentTick);

      if (currentTickValue === null || !Number.isFinite(currentTickValue))
        continue;

      const tickLower = Math.trunc(currentTickValue);
      const tickUpper = tickLower + 1;

      requests.push({
        chain_id: chainId,
        poolOperation: {
          poolAddress,
          operation: "add",
          amountUSD: amount,
          tickLower,
          tickUpper,
          timeHorizon: this.lpSimulationTimeHorizonMinutes,
        },
        priceImpact: false,
        includeIL: true,
      });
    }

    return requests;
  }

  private convertStrategyToTargetPositions(
    strategy: Strategy,
    lpSimulations: GetLpSimulateResponse[],
    supplyData: GetSupplyOpportunitiesResponse[],
    dexPools: Record<string, any>,
    chainId: string
  ): {
    targetLendingSupplyPositions?: LendingPosition[];
    targetLiquidityPositions?: TargetLiquidityPosition[];
  } {
    const targetLendingSupplyPositions: LendingPosition[] = [];
    const targetLiquidityPositions: TargetLiquidityPosition[] = [];

    if (
      !strategy ||
      !strategy.positions ||
      !Array.isArray(strategy.positions)
    ) {
      return {};
    }

    for (const position of strategy.positions) {
      if (position.type === "supply") {
        const supplyTokenAddress = lookupTokenAddress(position.asset, chainId);
        targetLendingSupplyPositions.push({
          protocol: this.normalizeProtocolType(position.protocol),
          token: supplyTokenAddress,
          vToken: position.vaultAddress,
          amount: position.amount.toString(),
        });
      } else if (position.type === "lp") {
        const lpInfo = this.findLpPositionInfo(
          position.poolAddress,
          lpSimulations,
          dexPools
        );
        if (lpInfo) {
          const allocationRatio = position.allocation
            ? position.allocation / 100
            : 1;
          targetLiquidityPositions.push({
            protocol: this.normalizeLpProtocol(position.protocol),
            poolAddress: position.poolAddress,
            token0Address: lpInfo.token0Address,
            token1Address: lpInfo.token1Address,
            targetTickLower: lpInfo.tickLower,
            targetTickUpper: lpInfo.tickUpper,
            targetAmount0: (lpInfo.token0Amount * allocationRatio).toString(),
            targetAmount1: (lpInfo.token1Amount * allocationRatio).toString(),
          });
        }
      }
    }

    const result: any = {};
    if (targetLendingSupplyPositions.length > 0)
      result.targetLendingSupplyPositions = targetLendingSupplyPositions;
    if (targetLiquidityPositions.length > 0)
      result.targetLiquidityPositions = targetLiquidityPositions;
    return result;
  }

  private findLpPositionInfo(
    poolAddress: string,
    lpSimulations: GetLpSimulateResponse[],
    dexPools: Record<string, any>
  ) {
    const normalizedPoolAddress = poolAddress.toLowerCase();

    let token0Amount = 0,
      token1Amount = 0,
      tickLower = 0,
      tickUpper = 0;
    for (const sim of lpSimulations) {
      if (sim.pool?.poolAddress?.toLowerCase() === normalizedPoolAddress) {
        token0Amount =
          this.parseNumber(sim.summary?.requiredTokens?.token0?.amount) || 0;
        token1Amount =
          this.parseNumber(sim.summary?.requiredTokens?.token1?.amount) || 0;
        tickLower = sim.pool?.position?.tickLower ?? 0;
        tickUpper = sim.pool?.position?.tickUpper ?? 0;
        break;
      }
    }

    let token0Address = "",
      token1Address = "";
    for (const [poolAddr, poolData] of Object.entries(dexPools)) {
      if (poolAddr.toLowerCase() === normalizedPoolAddress) {
        const snap = poolData?.currentSnapshot || {};
        token0Address = snap.token0Address || snap.token0 || "";
        token1Address = snap.token1Address || snap.token1 || "";
        break;
      }
    }

    if (
      !token0Address ||
      !token1Address ||
      (token0Amount === 0 && token1Amount === 0)
    )
      return null;
    return {
      token0Address,
      token1Address,
      token0Amount,
      token1Amount,
      tickLower,
      tickUpper,
    };
  }

  private normalizeProtocolType(protocol: string): ProtocolType {
    const normalized = protocol.toLowerCase();
    if (normalized === "aave" || normalized === "aavev3") return "aave";
    if (normalized === "euler" || normalized === "eulerv2") return "euler";
    if (normalized === "venus" || normalized === "venusv4") return "venus";
    return "aave";
  }

  private normalizeLpProtocol(
    protocol: string | undefined
  ): "uniswapV3" | "aerodromeSlipstream" {
    if (!protocol) throw new Error("LP protocol required");
    const normalized = protocol.toLowerCase();
    if (normalized.includes("uniswap")) return "uniswapV3";
    if (normalized.includes("aerodrome")) return "aerodromeSlipstream";
    throw new Error(`Invalid LP protocol: "${protocol}"`);
  }

  private formatStrategyDetails(strategy: Strategy): string {
    if (!strategy.positions || strategy.positions.length === 0) {
      return "No positions";
    }

    const details = strategy.positions
      .map((pos) => {
        const amountStr = `$${pos.amount.toFixed(2)}`;
        const allocStr = `${pos.allocation.toFixed(1)}%`;
        if (pos.type === "supply") {
          return `${pos.asset}(supply/${pos.protocol}): ${amountStr} (${allocStr})`;
        } else {
          const poolShort = pos.poolAddress
            ? pos.poolAddress.slice(0, 8)
            : "unknown";
          return `${poolShort}(lp/${pos.protocol}): ${amountStr} (${allocStr})`;
        }
      })
      .join(", ");

    return details;
  }

  private parseNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const sanitized = value.replace(/[%,$]/g, "").trim();
      const parsed = Number(sanitized);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  }

  private logRebalanceSwapPlan(
    result: CalculateRebalanceCostResult,
    chainId: string,
    index: number
  ): void {
    const swapSummaries = this.describeSwapRoutes(result, chainId);
    if (swapSummaries.length === 0) {
      return;
    }

    const safe = result.details?.safe ?? "unknown";
    this.logger.log(
      `Strategy ${index} swap plan (safe ${safe}): ${swapSummaries.join(" | ")}`
    );
  }

  private describeSwapRoutes(
    result: CalculateRebalanceCostResult,
    chainId: string
  ): string[] {
    const details = result.details;
    if (!details || !Array.isArray(details.routes)) {
      return [];
    }

    return details.routes
      .filter((route) => route?.actionType === "Swap")
      .map((route) => this.formatSwapRoute(route, chainId))
      .filter((summary): summary is string => Boolean(summary));
  }

  private formatSwapRoute(
    route: RebalanceRoute,
    chainId: string
  ): string | null {
    if (!route || !route.tokenA) {
      return null;
    }

    const fromMeta = this.resolveTokenMeta(route.tokenA, chainId);
    const toMeta = route.tokenB
      ? this.resolveTokenMeta(route.tokenB, chainId)
      : null;

    const amountIn = this.formatTokenAmount(route.amount, fromMeta.decimals);
    const amountOut = route.estimatedOutput
      ? this.formatTokenAmount(
          route.estimatedOutput,
          toMeta?.decimals ?? fromMeta.decimals
        )
      : null;

    const protocol = route.protocol || "unknown";
    const outputPart =
      amountOut && toMeta ? ` -> ${amountOut} ${toMeta.symbol}` : "";

    return `Swap ${amountIn} ${fromMeta.symbol}${outputPart} via ${protocol}`;
  }

  private resolveTokenMeta(
    tokenIdentifier: string,
    chainId: string
  ): { symbol: string; decimals: number } {
    const symbol =
      lookupTokenSymbol(tokenIdentifier, chainId) ??
      (tokenIdentifier?.startsWith("0x")
        ? `${tokenIdentifier.slice(0, 6)}...`
        : tokenIdentifier);

    const decimalsMap = TOKEN_DECIMALS_BY_CHAIN[chainId] || {};
    const decimals = symbol
      ? (decimalsMap[symbol.replace("...", "").toUpperCase()] ?? 18)
      : 18;

    return { symbol: symbol || "unknown", decimals };
  }

  private formatTokenAmount(amount: string | number, decimals: number): string {
    if (amount === null || amount === undefined) {
      return "0";
    }

    if (typeof amount === "number") {
      return amount.toFixed(4);
    }

    try {
      const raw = BigInt(amount);
      if (decimals <= 0) {
        return raw.toString();
      }

      const divisor = BigInt(10) ** BigInt(decimals);
      const whole = raw / divisor;
      const fraction = raw % divisor;
      if (fraction === BigInt(0)) {
        return whole.toString();
      }

      const fractionStr = fraction
        .toString()
        .padStart(decimals, "0")
        .replace(/0+$/, "");
      const displayFraction = fractionStr.slice(0, 6);
      return displayFraction
        ? `${whole.toString()}.${displayFraction}`
        : whole.toString();
    } catch {
      const numeric = Number(amount);
      if (!Number.isFinite(numeric)) {
        return String(amount);
      }
      return numeric.toFixed(4);
    }
  }

  private normalizeDictionaryResponse<T>(data: any): T[] {
    if (!data) return [];
    if (Array.isArray(data)) return data as T[];
    if (typeof data === "object") {
      const entries = Object.entries(data).filter(
        ([key]) => key !== "_dataSource"
      );
      if (entries.length === 0) return [];
      entries.sort((a, b) => {
        const aNum = Number(a[0]),
          bNum = Number(b[0]);
        const aIsNum = !Number.isNaN(aNum),
          bIsNum = !Number.isNaN(bNum);
        if (aIsNum && bIsNum) return aNum - bNum;
        if (aIsNum) return -1;
        if (bIsNum) return 1;
        return a[0].localeCompare(b[0]);
      });
      return entries.map(([, value]) => value as T);
    }
    return [];
  }
}
