import { Inject, Injectable, Logger } from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { AccountYieldSummaryResponse } from '../agent/types/mcp.types';
import {
  lookupTokenAddress,
  lookupTokenSymbol,
  TOKEN_DECIMALS_BY_CHAIN,
} from '../agent/token-utils';
import { MarginalOptimizerService } from './portfolio-optimizer/marginal-optimizer.service';
import { OpportunityConverterService } from './portfolio-optimizer/opportunity-converter.service';
import { getAddress, toHex } from 'viem';
import { UserDeployment } from '../user/entities/user-deployment.entity';
import { stringify as uuidStringify } from 'uuid';
import protocolConfig from '../../config/protocol.config';
import { ConfigType } from '@nestjs/config';
import { UserService } from '../user/user.service';
import { getNetworkDto } from '../../common/dto/network.dto';
import { PoolSnapshotCachesListResponseDto } from '../tracker/dto/pool-snapshot.response.dto';
import { PortfolioResponseDto } from '../user/dto/user-portfolio.response.dto';
import {
  IdleAssetsResponse,
  ActiveInvestmentsResponse,
  AccountLendingPosition,
  AccountLiquidityPosition,
  CalculateRebalanceCostResult,
  CalculateSwapCostBatchRequest,
  ChainId,
  DexPoolActiveTick,
  DexPoolActiveTicksTimeframe,
  DexPoolData,
  DexPoolPricePosition,
  DexPoolSnapshot,
  GetDexPoolsResponse,
  GetLpSimulateRequest,
  GetLpSimulateResponse,
  GetSupplyOpportunitiesResponse,
  LendingPosition,
  ProcessedRebalanceArgs,
  ProtocolType,
  RebalanceRoute,
  TargetLiquidityPosition,
  TokenBalance,
  ProcessedLiquidityPosition,
} from '../agent/types/mcp.types';
import { TrackerService } from '../tracker/tracker.service';
import { APYCalculatorService } from './portfolio-optimizer/apy-calculator.service';
import { OwliaGuardService } from '../owlia-guard/owlia-guard.service';

export interface StrategyPosition {
  type: 'supply' | 'lp';
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
  LP_IN_RANGE = 'LP_IN_RANGE', // LP position exists and is in range
  LP_OUT_OF_RANGE = 'LP_OUT_OF_RANGE', // LP position exists but is out of range
  LENDING_ONLY = 'LENDING_ONLY', // Only lending positions, no LP
  NO_POSITION = 'NO_POSITION', // No active positions
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
    private readonly opportunityConverter: OpportunityConverterService,
    private readonly userService: UserService,
    private readonly trackerService: TrackerService,
    private readonly apyCalculator: APYCalculatorService,
    private readonly owliaGuardService: OwliaGuardService,
    @Inject(protocolConfig.KEY)
    private readonly protocols: ConfigType<typeof protocolConfig>,
  ) {}

  async evaluate(deployment: UserDeployment): Promise<RebalancePrecheckResult> {
    const chainId = deployment.chainId.toString() as ChainId;

    // Fetch data
    const { yieldSummary, totalAssetsUsd, portfolioApy, currentHoldings } =
      await this.fetchUserData(deployment);

    if (!yieldSummary || totalAssetsUsd < 50) {
      return this.rejectResult(
        portfolioApy,
        totalAssetsUsd,
        yieldSummary || undefined,
      );
    }

    const { lpSimulations, supplyOpportunities, dexPools } =
      await this.fetchOpportunities(deployment, chainId, totalAssetsUsd);

    // Determine current position status to apply appropriate constraints
    const positionStatus = this.determinePositionStatus(yieldSummary, dexPools);
    this.logger.log(
      `Position status for user ${deployment.userId}: ${positionStatus}`,
    );

    // Build optimized strategies
    const allStrategies = await this.buildOptimizedStrategies(
      lpSimulations,
      supplyOpportunities,
      totalAssetsUsd,
      chainId,
      dexPools,
      getAddress(toHex(deployment.address)),
      currentHoldings,
    );

    if (allStrategies.length === 0) {
      return this.rejectResult(
        portfolioApy,
        totalAssetsUsd,
        yieldSummary,
        'No valid strategies',
      );
    }

    this.logger.log(
      `Built ${allStrategies.length} strategies for user ${deployment.userId}`,
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
      getAddress(toHex(deployment.address)),
      chainId,
      lpSimulations,
      supplyOpportunities,
      dexPools,
      totalAssetsUsd,
      portfolioApy,
      positionStatus,
      yieldSummary,
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
      uuidStringify(deployment.userId),
      positionStatus,
      evaluationRecords,
    );
  }

  private async fetchUserData(deployment: UserDeployment): Promise<{
    yieldSummary: AccountYieldSummaryResponse | null;
    totalAssetsUsd: number;
    portfolioApy: number;
    currentHoldings: Record<string, number>;
  }> {
    try {
      const userPortfolio = await this.userService.getUserPortfolio(
        getNetworkDto(deployment.chainId),
        getAddress(toHex(deployment.address)),
      );

      const totalAssetsUsd =
        this.parseNumber(userPortfolio.summary.assetUsd) || 0;

      // Convert PortfolioResponseDto to AccountYieldSummaryResponse
      const yieldSummary = this.convertPortfolioToYieldSummary(
        userPortfolio,
        getAddress(toHex(deployment.address)),
      );

      // Calculate weighted average portfolio APY
      const portfolioApy = this.calculatePortfolioApy(userPortfolio);

      // Extract current token holdings from positions
      const currentHoldings = yieldSummary
        ? this.extractCurrentHoldings(yieldSummary)
        : {};

      this.logger.log(
        `Portfolio for user ${deployment.userId}: totalAssets=$${totalAssetsUsd}, APY=${portfolioApy}%, ` +
          `holdings=${JSON.stringify(currentHoldings)}, ` +
          `yieldSummary=${JSON.stringify(yieldSummary)}`,
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
    dexPools: Record<string, any>,
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
              const poolData = dexPools[poolAddress];
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
              const poolData = dexPools[poolAddress];
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
   * 从 yieldSummary 构建当前仓位，用于传给 OwliaGuard 做成本评估
   */
  private buildCurrentPortfolioStateForRebalance(
    yieldSummary: AccountYieldSummaryResponse,
  ): {
    balances: TokenBalance[];
    lendingPositions: LendingPosition[];
    liquidityPositions: ProcessedLiquidityPosition[];
  } {
    const balances: TokenBalance[] = [];
    const lendingPositions: LendingPosition[] = [];
    const liquidityPositions: ProcessedLiquidityPosition[] = [];

    // 1) Idle 资产 => currentBalances
    if (yieldSummary.idleAssets?.assets) {
      for (const asset of yieldSummary.idleAssets.assets) {
        if (!asset.tokenAddress || !asset.balance) continue;
        balances.push({
          token: asset.tokenAddress,
          amount: asset.balance,
        });
      }
    }

    const active = yieldSummary.activeInvestments;
    if (active) {
      // 2) Lending 仓位 => currentLendingSupplyPositions
      const lending = active.lendingInvestments;
      if (lending?.positions) {
        for (const pos of lending.positions) {
          const supplies = pos.protocolPositions?.supplies || [];
          for (const s of supplies) {
            lendingPositions.push({
              protocol: this.normalizeProtocolType(pos.protocol),
              token: s.tokenAddress,
              vToken: s.vTokenAddress ?? null,
              amount: s.supplyAmount,
            });
          }
        }
      }

      // 3) Uniswap V3 LP 仓位 => currentLiquidityPositions
      const uni = active.uniswapV3LiquidityInvestments;
      if (uni?.positions) {
        for (const lp of uni.positions) {
          for (const proto of lp.protocolPositions || []) {
            const poolAddress = proto.poolInfo?.poolAddress;
            if (!poolAddress) continue;
            for (const dep of proto.deposits || []) {
              const extra = dep.extraData;
              if (!extra?.tokenId) continue;
              liquidityPositions.push({
                protocol: 'uniswapV3',
                tokenId: extra.tokenId.toString(),
                poolAddress,
              });
            }
          }
        }
      }

      // 4) Aerodrome Slipstream LP 仓位
      const aero = active.aerodromeSlipstreamLiquidityInvestments;
      if (aero?.positions) {
        for (const lp of aero.positions) {
          for (const proto of lp.protocolPositions || []) {
            const poolAddress = proto.poolInfo?.poolAddress;
            if (!poolAddress) continue;
            for (const dep of proto.deposits || []) {
              const extra = dep.extraData;
              if (!extra?.tokenId) continue;
              liquidityPositions.push({
                protocol: 'aerodromeSlipstream',
                tokenId: extra.tokenId.toString(),
                poolAddress,
              });
            }
          }
        }
      }
    }

    return { balances, lendingPositions, liquidityPositions };
  }

  /**
   * Get rebalancing constraints based on current position status
   */
  private getConstraintsByPositionStatus(
    status: PositionStatus,
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
    yieldSummary: AccountYieldSummaryResponse,
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

  /**
   * Convert PortfolioResponseDto to AccountYieldSummaryResponse
   */
  private convertPortfolioToYieldSummary(
    portfolio: PortfolioResponseDto,
    accountAddress: string,
  ): AccountYieldSummaryResponse {
    // Build idle assets from wallet
    const idleAssets = this.buildIdleAssets(portfolio, accountAddress);

    // Build active investments from protocols
    const activeInvestments = this.buildActiveInvestments(portfolio);

    const totalAssetsUsd = portfolio.summary.assetUsd;

    return {
      idleAssets,
      activeInvestments,
      totalAssetsUsd,
      portfolioApy: '0', // Will be calculated separately
    };
  }

  /**
   * Build IdleAssetsResponse from portfolio wallet
   */
  private buildIdleAssets(
    portfolio: PortfolioResponseDto,
    accountAddress: string,
  ): IdleAssetsResponse {
    const assets = portfolio.wallet.map((wallet) => {
      const tokenInfo = portfolio.tokens[wallet.tokenAddress];
      return {
        tokenAddress: wallet.tokenAddress,
        tokenSymbol: tokenInfo?.symbol || 'UNKNOWN',
        balance: wallet.amount,
        balanceUsd: wallet.amountUsd,
        tokenPriceUsd: tokenInfo?.priceUsd || '0',
      };
    });

    const idleAssetsUsd = portfolio.summary.walletUsd;
    const totalAssetsUsd = this.parseNumber(portfolio.summary.assetUsd) || 0;
    const deploymentRate =
      totalAssetsUsd > 0
        ? (
            ((totalAssetsUsd - this.parseNumber(idleAssetsUsd)!) /
              totalAssetsUsd) *
            100
          ).toFixed(2)
        : '0';

    return {
      account: accountAddress,
      idleAssetsUsd,
      deploymentRate,
      assets,
    };
  }

  /**
   * Build ActiveInvestmentsResponse from portfolio protocols
   */
  private buildActiveInvestments(
    portfolio: PortfolioResponseDto,
  ): ActiveInvestmentsResponse {
    const lendingPositions: AccountLendingPosition[] = [];
    const uniswapV3Positions: AccountLiquidityPosition[] = [];
    const aerodromePositions: AccountLiquidityPosition[] = [];

    let totalLendingSuppliedUsd = 0;
    let totalLendingBorrowedUsd = 0;
    let totalLendingNetWorthUsd = 0;
    let minHealthFactor: number | null = null;

    let totalUniswapV3ValueUsd = 0;
    let totalUniswapV3DeployedUsd = 0;
    let totalUniswapV3RewardsUsd = 0;
    let uniswapV3PositionCount = 0;
    let totalUniswapV3Apy = 0;

    let totalAerodromeValueUsd = 0;
    let totalAerodromeDeployedUsd = 0;
    let totalAerodromeRewardsUsd = 0;
    let aerodromePositionCount = 0;
    let totalAerodromeApy = 0;

    for (const protocol of portfolio.protocols) {
      // Handle lending protocols (Aave, Euler, Venus)
      if (protocol.id === 'aave-v3') {
        const aave = protocol as any;
        const supplies = (aave.supplied || []).map((s: any) => ({
          tokenSymbol: this.getTokenSymbolFromPortfolio(
            s.tokenAddress,
            portfolio,
          ),
          tokenAddress: s.tokenAddress,
          vTokenAddress: null,
          supplyAmount: s.amount,
          supplyAmountUsd: s.amountUsd,
          supplyApy: s.supplyApy,
        }));

        const borrows = (aave.borrowed || []).map((b: any) => ({
          tokenSymbol: this.getTokenSymbolFromPortfolio(
            b.tokenAddress,
            portfolio,
          ),
          tokenAddress: b.tokenAddress,
          borrowAmount: b.amount,
          borrowAmountUsd: b.amountUsd,
          borrowApy: b.borrowApy,
        }));

        const netWorth = this.parseNumber(aave.netUsd) || 0;
        totalLendingNetWorthUsd += netWorth;
        totalLendingSuppliedUsd += this.parseNumber(aave.assetUsd) || 0;
        totalLendingBorrowedUsd += this.parseNumber(aave.debtUsd) || 0;

        const hf = this.parseNumber(aave.healthFactor);
        if (hf !== null && (minHealthFactor === null || hf < minHealthFactor)) {
          minHealthFactor = hf;
        }

        lendingPositions.push({
          protocol: 'aaveV3',
          accountId: null,
          protocolPositions: {
            supplies,
            borrows,
            totalSupplyUsd: aave.assetUsd,
            totalBorrowUsd: aave.debtUsd,
            totalNetWorthUsd: aave.netUsd,
            totalApy: aave.netApy || '0',
            ltv: aave.ltv || '0',
            liquidationThreshold: aave.liquidationThreshold || '0',
            healthFactor: aave.healthFactor || '0',
          },
        });
      } else if (protocol.id === 'venus-v4') {
        const venus = protocol as any;
        const supplies = (venus.supplied || []).map((s: any) => ({
          tokenSymbol: this.getTokenSymbolFromPortfolio(
            s.tokenAddress,
            portfolio,
          ),
          tokenAddress: s.tokenAddress,
          vTokenAddress: null,
          supplyAmount: s.amount,
          supplyAmountUsd: s.amountUsd,
          supplyApy: s.supplyApy,
        }));

        const borrows = (venus.borrowed || []).map((b: any) => ({
          tokenSymbol: this.getTokenSymbolFromPortfolio(
            b.tokenAddress,
            portfolio,
          ),
          tokenAddress: b.tokenAddress,
          borrowAmount: b.amount,
          borrowAmountUsd: b.amountUsd,
          borrowApy: b.borrowApy,
        }));

        const netWorth = this.parseNumber(venus.netUsd) || 0;
        totalLendingNetWorthUsd += netWorth;
        totalLendingSuppliedUsd += this.parseNumber(venus.assetUsd) || 0;
        totalLendingBorrowedUsd += this.parseNumber(venus.debtUsd) || 0;

        const hf = this.parseNumber(venus.healthFactor);
        if (hf !== null && (minHealthFactor === null || hf < minHealthFactor)) {
          minHealthFactor = hf;
        }

        lendingPositions.push({
          protocol: 'venusV4',
          accountId: null,
          protocolPositions: {
            supplies,
            borrows,
            totalSupplyUsd: venus.assetUsd,
            totalBorrowUsd: venus.debtUsd,
            totalNetWorthUsd: venus.netUsd,
            totalApy: venus.netApy || '0',
            ltv: venus.ltv || '0',
            liquidationThreshold: venus.liquidationThreshold || '0',
            healthFactor: venus.healthFactor || '0',
          },
        });
      } else if (protocol.id === 'euler-v2') {
        const euler = protocol as any;
        const subAccounts = euler.subAccounts || [];

        for (const subAccount of subAccounts) {
          const supplies = (subAccount.supplied || []).map((s: any) => ({
            tokenSymbol: this.getTokenSymbolFromPortfolio(
              s.underlying,
              portfolio,
            ),
            tokenAddress: s.underlying,
            vTokenAddress: s.vault,
            supplyAmount: s.supplyAmount,
            supplyAmountUsd: s.supplyAmountUsd,
            supplyApy: s.supplyApy,
          }));

          const borrows = (subAccount.borrowed || []).map((b: any) => ({
            tokenSymbol: this.getTokenSymbolFromPortfolio(
              b.underlying,
              portfolio,
            ),
            tokenAddress: b.underlying,
            borrowAmount: b.borrowAmount,
            borrowAmountUsd: b.borrowAmountUsd,
            borrowApy: b.borrowApy,
          }));

          const netWorth = this.parseNumber(subAccount.collateralValueUsd) || 0;
          totalLendingNetWorthUsd += netWorth;
          totalLendingSuppliedUsd +=
            this.parseNumber(subAccount.collateralValueUsd) || 0;
          totalLendingBorrowedUsd +=
            this.parseNumber(subAccount.liabilityValueUsd) || 0;

          lendingPositions.push({
            protocol: 'eulerV2',
            accountId: subAccount.subAccountId?.toString() || null,
            protocolPositions: {
              supplies,
              borrows,
              totalSupplyUsd: subAccount.collateralValueUsd,
              totalBorrowUsd: subAccount.liabilityValueUsd,
              totalNetWorthUsd: subAccount.collateralValueUsd,
              totalApy: subAccount.netApy || '0',
              ltv: '0',
              liquidationThreshold: '0',
              healthFactor: subAccount.healthScore || '0',
            },
          });
        }
      }
      // Handle liquidity protocols
      else if (protocol.id === 'uniswap-v3') {
        const uniswap = protocol as any;
        const positions = uniswap.positions || [];

        for (const position of positions) {
          const positionUsd = this.parseNumber(position.positionUsd) || 0;
          const apy = this.parseNumber(position.apy) || 0;

          totalUniswapV3ValueUsd += positionUsd;
          totalUniswapV3DeployedUsd += positionUsd;
          totalUniswapV3RewardsUsd +=
            (this.parseNumber(position.tokensOwed0Usd) || 0) +
            (this.parseNumber(position.tokensOwed1Usd) || 0);
          uniswapV3PositionCount++;
          totalUniswapV3Apy += apy * positionUsd;

          const token0Symbol = this.getTokenSymbolFromPortfolio(
            position.token0,
            portfolio,
          );
          const token1Symbol = this.getTokenSymbolFromPortfolio(
            position.token1,
            portfolio,
          );

          uniswapV3Positions.push({
            protocol: 'uniswapV3',
            protocolPositions: [
              {
                poolInfo: {
                  poolAddress: position.poolAddress,
                  tokens: [
                    { address: position.token0, symbol: token0Symbol },
                    { address: position.token1, symbol: token1Symbol },
                  ],
                  fee: position.fee,
                },
                totalNetWorthUsd: position.positionUsd,
                apy: position.apy,
                deposits: [
                  {
                    positionApy: position.apy,
                    depositedAmountUsd: position.positionUsd,
                    unclaimedRewardsAmountUsd: (
                      (this.parseNumber(position.tokensOwed0Usd) || 0) +
                      (this.parseNumber(position.tokensOwed1Usd) || 0)
                    ).toString(),
                    extraData: {
                      tokenId: position.tokenId,
                      tick: position.tickLower, // Use tickLower as tick
                      tickLower: position.tickLower,
                      tickUpper: position.tickUpper,
                      token0: token0Symbol,
                      token1: token1Symbol,
                      token0Amount: position.amount0,
                      token1Amount: position.amount1,
                      token0AmountUsd: position.amount0Usd,
                      token1AmountUsd: position.amount1Usd,
                      unclaimedRewardToken0Amount: position.tokensOwed0,
                      unclaimedRewardToken1Amount: position.tokensOwed1,
                      unclaimedRewardToken0AmountUsd: position.tokensOwed0Usd,
                      unclaimedRewardToken1AmountUsd: position.tokensOwed1Usd,
                    },
                  },
                ],
              },
            ],
          });
        }
      } else if (protocol.id === 'aerodrome-cl') {
        const aerodrome = protocol as any;
        const positions = aerodrome.positions || [];

        for (const position of positions) {
          const positionUsd = this.parseNumber(position.positionUsd) || 0;
          const apy = this.parseNumber(position.apy) || 0;

          totalAerodromeValueUsd += positionUsd;
          totalAerodromeDeployedUsd += positionUsd;
          totalAerodromeRewardsUsd +=
            (this.parseNumber(position.tokensOwed0Usd) || 0) +
            (this.parseNumber(position.tokensOwed1Usd) || 0);
          aerodromePositionCount++;
          totalAerodromeApy += apy * positionUsd;

          const token0Symbol = this.getTokenSymbolFromPortfolio(
            position.token0,
            portfolio,
          );
          const token1Symbol = this.getTokenSymbolFromPortfolio(
            position.token1,
            portfolio,
          );

          aerodromePositions.push({
            protocol: 'aerodromeSlipstream',
            protocolPositions: [
              {
                poolInfo: {
                  poolAddress: position.poolAddress,
                  tokens: [
                    { address: position.token0, symbol: token0Symbol },
                    { address: position.token1, symbol: token1Symbol },
                  ],
                  fee: position.fee,
                },
                totalNetWorthUsd: position.positionUsd,
                apy: position.apy,
                deposits: [
                  {
                    positionApy: position.apy,
                    depositedAmountUsd: position.positionUsd,
                    unclaimedRewardsAmountUsd: (
                      (this.parseNumber(position.tokensOwed0Usd) || 0) +
                      (this.parseNumber(position.tokensOwed1Usd) || 0)
                    ).toString(),
                    extraData: {
                      tokenId: position.tokenId,
                      tick: position.tickLower,
                      tickLower: position.tickLower,
                      tickUpper: position.tickUpper,
                      token0: token0Symbol,
                      token1: token1Symbol,
                      token0Amount: position.amount0,
                      token1Amount: position.amount1,
                      token0AmountUsd: position.amount0Usd,
                      token1AmountUsd: position.amount1Usd,
                      unclaimedRewardToken0Amount: position.tokensOwed0,
                      unclaimedRewardToken1Amount: position.tokensOwed1,
                      unclaimedRewardToken0AmountUsd: position.tokensOwed0Usd,
                      unclaimedRewardToken1AmountUsd: position.tokensOwed1Usd,
                    },
                  },
                ],
              },
            ],
          });
        }
      }
    }

    // Build lending investments summary
    const lendingInvestments =
      lendingPositions.length > 0
        ? {
            netWorthUsd: totalLendingNetWorthUsd.toString(),
            totalSuppliedUsd: totalLendingSuppliedUsd.toString(),
            totalBorrowedUsd: totalLendingBorrowedUsd.toString(),
            netApy:
              totalLendingNetWorthUsd > 0
                ? (
                    lendingPositions.reduce((sum, pos) => {
                      const netWorth =
                        this.parseNumber(
                          pos.protocolPositions.totalNetWorthUsd,
                        ) || 0;
                      const apy =
                        this.parseNumber(pos.protocolPositions.totalApy) || 0;
                      return sum + netWorth * apy;
                    }, 0) / totalLendingNetWorthUsd
                  ).toFixed(4)
                : '0',
            healthFactorMin: (minHealthFactor ?? 0).toString(),
            leverageRatio:
              totalLendingSuppliedUsd > 0
                ? (totalLendingBorrowedUsd / totalLendingSuppliedUsd).toFixed(4)
                : '0',
            positions: lendingPositions,
          }
        : null;

    // Build Uniswap V3 liquidity investments summary
    const uniswapV3LiquidityInvestments =
      uniswapV3Positions.length > 0
        ? {
            totalValueUsd: totalUniswapV3ValueUsd.toString(),
            totalDeployedUsd: totalUniswapV3DeployedUsd.toString(),
            pendingRewardsUsd: totalUniswapV3RewardsUsd.toString(),
            avgApy:
              totalUniswapV3DeployedUsd > 0
                ? (totalUniswapV3Apy / totalUniswapV3DeployedUsd).toFixed(4)
                : '0',
            activePositions: uniswapV3PositionCount,
            positions: uniswapV3Positions,
          }
        : null;

    // Build Aerodrome liquidity investments summary
    const aerodromeSlipstreamLiquidityInvestments =
      aerodromePositions.length > 0
        ? {
            totalValueUsd: totalAerodromeValueUsd.toString(),
            totalDeployedUsd: totalAerodromeDeployedUsd.toString(),
            pendingRewardsUsd: totalAerodromeRewardsUsd.toString(),
            avgApy:
              totalAerodromeDeployedUsd > 0
                ? (totalAerodromeApy / totalAerodromeDeployedUsd).toFixed(4)
                : '0',
            activePositions: aerodromePositionCount,
            positions: aerodromePositions,
          }
        : null;

    // Calculate performance summary
    const totalActiveInvestmentsUsd =
      totalLendingNetWorthUsd + totalUniswapV3ValueUsd + totalAerodromeValueUsd;

    const weightedApy =
      totalActiveInvestmentsUsd > 0
        ? ((lendingInvestments
            ? (this.parseNumber(lendingInvestments.netApy) || 0) *
              totalLendingNetWorthUsd
            : 0) +
            (uniswapV3LiquidityInvestments
              ? (this.parseNumber(uniswapV3LiquidityInvestments.avgApy) || 0) *
                totalUniswapV3ValueUsd
              : 0) +
            (aerodromeSlipstreamLiquidityInvestments
              ? (this.parseNumber(
                  aerodromeSlipstreamLiquidityInvestments.avgApy,
                ) || 0) * totalAerodromeValueUsd
              : 0)) /
          totalActiveInvestmentsUsd
        : 0;

    const performanceSummary = {
      weightedApy: weightedApy.toFixed(4),
      totalYieldUsd: '0', // Not available from portfolio
      riskLevel: this.assessRiskLevel(
        minHealthFactor,
        totalLendingBorrowedUsd,
        totalLendingSuppliedUsd,
      ) as 'low' | 'medium' | 'high',
    };

    // Build risk metrics
    const riskMetrics = {
      concentrationRisk: this.assessConcentrationRisk(
        totalLendingNetWorthUsd,
        totalUniswapV3ValueUsd,
        totalAerodromeValueUsd,
        totalActiveInvestmentsUsd,
      ) as 'low' | 'medium' | 'high',
      liquidationRisk: this.assessLiquidationRisk(minHealthFactor) as
        | 'low'
        | 'medium'
        | 'high',
      protocolDiversification: this.assessProtocolDiversification(
        lendingPositions.length,
        uniswapV3Positions.length,
        aerodromePositions.length,
      ) as 'low' | 'medium' | 'high',
    };

    return {
      activeInvestmentsUsd: totalActiveInvestmentsUsd.toString(),
      performanceSummary,
      uniswapV3LiquidityInvestments,
      aerodromeSlipstreamLiquidityInvestments,
      lendingInvestments,
      riskMetrics,
    };
  }

  /**
   * Calculate weighted average portfolio APY from all protocols
   */
  private calculatePortfolioApy(portfolio: PortfolioResponseDto): number {
    let totalWeightedApy = 0;
    let totalWeight = 0;

    for (const protocol of portfolio.protocols) {
      const netUsd = this.parseNumber(protocol.netUsd) || 0;
      if (netUsd <= 0) continue;

      let apy = 0;
      if ('netApy' in protocol && protocol.netApy) {
        apy = this.parseNumber(protocol.netApy) || 0;
      } else if (
        protocol.id === 'uniswap-v3' ||
        protocol.id === 'aerodrome-cl'
      ) {
        // For LP protocols, calculate weighted average from positions
        const positions = (protocol as any).positions || [];
        let positionWeightedApy = 0;
        let positionTotalUsd = 0;

        for (const position of positions) {
          const positionUsd = this.parseNumber(position.positionUsd) || 0;
          const positionApy = this.parseNumber(position.apy) || 0;
          if (positionUsd > 0) {
            positionWeightedApy += positionApy * positionUsd;
            positionTotalUsd += positionUsd;
          }
        }

        if (positionTotalUsd > 0) {
          apy = positionWeightedApy / positionTotalUsd;
        }
      }

      if (apy > 0) {
        totalWeightedApy += apy * netUsd;
        totalWeight += netUsd;
      }
    }

    // Include wallet (idle assets) with 0% APY
    const walletUsd = this.parseNumber(portfolio.summary.walletUsd) || 0;
    totalWeight += walletUsd;

    return totalWeight > 0 ? totalWeightedApy / totalWeight : 0;
  }

  /**
   * Helper to get token symbol from portfolio tokens
   */
  private getTokenSymbolFromPortfolio(
    tokenAddress: string,
    portfolio: PortfolioResponseDto,
  ): string {
    const tokenInfo = portfolio.tokens[tokenAddress];
    return tokenInfo?.symbol || 'UNKNOWN';
  }

  /**
   * Assess risk level based on health factor and leverage
   */
  private assessRiskLevel(
    minHealthFactor: number | null,
    totalBorrowed: number,
    totalSupplied: number,
  ): 'low' | 'medium' | 'high' {
    if (minHealthFactor !== null && minHealthFactor < 1.5) return 'high';
    if (minHealthFactor !== null && minHealthFactor < 2.0) return 'medium';
    if (totalBorrowed > 0 && totalSupplied > 0) {
      const leverage = totalBorrowed / totalSupplied;
      if (leverage > 0.8) return 'high';
      if (leverage > 0.5) return 'medium';
    }
    return 'low';
  }

  /**
   * Assess concentration risk
   */
  private assessConcentrationRisk(
    lendingUsd: number,
    uniswapUsd: number,
    aerodromeUsd: number,
    totalUsd: number,
  ): 'low' | 'medium' | 'high' {
    if (totalUsd === 0) return 'low';
    const maxConcentration = Math.max(
      lendingUsd / totalUsd,
      uniswapUsd / totalUsd,
      aerodromeUsd / totalUsd,
    );
    if (maxConcentration > 0.8) return 'high';
    if (maxConcentration > 0.6) return 'medium';
    return 'low';
  }

  /**
   * Assess liquidation risk
   */
  private assessLiquidationRisk(
    minHealthFactor: number | null,
  ): 'low' | 'medium' | 'high' {
    if (minHealthFactor === null) return 'low';
    if (minHealthFactor < 1.5) return 'high';
    if (minHealthFactor < 2.0) return 'medium';
    return 'low';
  }

  /**
   * Assess protocol diversification
   */
  private assessProtocolDiversification(
    lendingCount: number,
    uniswapCount: number,
    aerodromeCount: number,
  ): 'low' | 'medium' | 'high' {
    const totalPositions = lendingCount + uniswapCount + aerodromeCount;
    if (totalPositions === 0) return 'low';
    if (totalPositions >= 5) return 'high';
    if (totalPositions >= 3) return 'medium';
    return 'low';
  }

  /**
   * Convert tracker pool snapshot caches list to GetDexPoolsResponse
   */
  private convertPoolSnapshotsToDexPools(
    cachesList: PoolSnapshotCachesListResponseDto,
  ): GetDexPoolsResponse {
    const dexPools: GetDexPoolsResponse = {};

    if (!cachesList?.latestSnapshots) {
      return dexPools;
    }

    for (const latest of cachesList.latestSnapshots) {
      const snap = latest.currentSnapshot;
      if (!snap?.poolAddress) continue;

      const poolAddress = snap.poolAddress;

      const currentSnapshot: DexPoolSnapshot = {
        dexKey: snap.dexKey,
        timestampMs: snap.timestampMs,
        poolAddress: snap.poolAddress,
        token0: snap.token0,
        token1: snap.token1,
        token0Symbol: snap.token0Symbol,
        token1Symbol: snap.token1Symbol,
        fee: snap.fee,
        currentTick: snap.currentTick,
        tickSpacing: snap.tickSpacing,
        currentPrice: snap.currentPrice,
        startTick: snap.startTick,
        tvl: snap.tvl,
      };

      // --- Price/tick geometry (ported from getLatestPoolSnapshots) ---
      const currentTick = parseInt(snap.currentTick);
      const tickSpacing = parseInt(snap.tickSpacing || '1') || 1;

      const tickSpacingLowerBound =
        Math.floor(currentTick / tickSpacing) * tickSpacing;
      const tickSpacingUpperBound = tickSpacingLowerBound + tickSpacing;

      // Calculate current price from sqrtPriceX96 if available, otherwise from tick
      let currentPriceString: string;
      let currentPrice: number;
      if (snap.currentPrice) {
        try {
          const sqrtPriceX96 = BigInt(snap.currentPrice);
          const Q96 = BigInt(2) ** BigInt(96);
          const priceX192 = sqrtPriceX96 * Q96;
          const Q192 = Q96 * Q96;

          const integerPart = priceX192 / Q192;
          const remainder = priceX192 % Q192;

          const decimalPart = (remainder * BigInt(10) ** BigInt(18)) / Q192;

          currentPriceString =
            integerPart.toString() +
            '.' +
            decimalPart.toString().padStart(18, '0');
          currentPrice = Number(integerPart) + Number(decimalPart) / 1e18;
        } catch {
          // Fallback to tick-based price if bigint math fails
          currentPrice = Math.pow(1.0001, currentTick);
          currentPriceString = currentPrice.toFixed(18);
        }
      } else {
        currentPrice = Math.pow(1.0001, currentTick);
        currentPriceString = currentPrice.toFixed(18);
      }

      const lowerBoundPrice = Math.pow(1.0001, tickSpacingLowerBound);
      const upperBoundPrice = Math.pow(1.0001, tickSpacingUpperBound);

      const tickPositionInSpacing =
        tickSpacing > 0
          ? ((currentTick - tickSpacingLowerBound) / tickSpacing) * 100
          : 0;

      const priceRange = upperBoundPrice - lowerBoundPrice;
      const pricePositionInRange =
        priceRange > 0
          ? ((currentPrice - lowerBoundPrice) / priceRange) * 100
          : 0;

      const tickPositionText = `${tickPositionInSpacing.toFixed(2)}%`;
      const pricePositionText = `${pricePositionInRange.toFixed(2)}%`;

      let description: string;
      if (tickPositionInSpacing === 0) {
        description = 'At lower bound';
      } else if (tickPositionInSpacing === 100) {
        description = 'At upper bound';
      } else if (tickPositionInSpacing < 25) {
        description = 'Near lower bound';
      } else if (tickPositionInSpacing < 50) {
        description = 'Lower half';
      } else if (tickPositionInSpacing < 75) {
        description = 'Upper half';
      } else {
        description = 'Near upper bound';
      }

      // Active ticks context across multiple timeframes
      const nowMs = Date.now();
      const timePeriodsMinutes: Record<string, number> = {
        '5min': 5,
        '15min': 15,
        '30min': 30,
        '1hr': 60,
        '6hr': 360,
      };

      const activeTicksContext: {
        [timeframe: string]: DexPoolActiveTicksTimeframe;
      } = {};

      for (const [periodName, minutes] of Object.entries(timePeriodsMinutes)) {
        const cutoffTime = nowMs - minutes * 60 * 1000;
        const relevantSnapshots =
          latest.snapshots?.filter(
            (s) => Number(s.timestampMs) >= cutoffTime,
          ) ?? [];

        const ticksWithVolume = new Map<string, number>();

        for (const snapItem of relevantSnapshots) {
          for (const tickInfo of snapItem.ticks || []) {
            const volume = this.parseNumber(tickInfo.tradingVolume) || 0;
            if (volume > 0) {
              const currentVolume = ticksWithVolume.get(tickInfo.tick) || 0;
              ticksWithVolume.set(tickInfo.tick, currentVolume + volume);
            }
          }
        }

        const activeTicks = Array.from(ticksWithVolume.keys())
          .map((t) => parseInt(t))
          .sort((a, b) => a - b);

        if (activeTicks.length === 0) {
          continue;
        }

        const minActiveTick = activeTicks[0];
        const maxActiveTick = activeTicks[activeTicks.length - 1];

        let nearestLowerTick = minActiveTick;
        let nearestUpperTick = maxActiveTick + 1;

        for (let i = 0; i < activeTicks.length - 1; i++) {
          if (
            activeTicks[i] <= currentTick &&
            activeTicks[i + 1] > currentTick
          ) {
            nearestLowerTick = activeTicks[i];
            nearestUpperTick = activeTicks[i + 1] + 1;
            break;
          }
        }

        const totalVolume = Array.from(ticksWithVolume.values()).reduce(
          (sum, vol) => sum + vol,
          0,
        );

        const ticksWithVolumeArr = Array.from(ticksWithVolume.entries())
          .map(([tick, volume]) => ({
            tick: parseInt(tick),
            volume: volume.toFixed(2),
          }))
          .sort((a, b) => a.tick - b.tick);

        activeTicksContext[periodName] = {
          totalActiveTicks: activeTicks.length,
          totalVolume: totalVolume.toFixed(2),
          range: {
            min: minActiveTick,
            max: maxActiveTick,
            span: maxActiveTick - minActiveTick,
          },
          nearestActiveTicks: {
            lower: nearestLowerTick,
            upper: nearestUpperTick,
          },
          ticksWithVolume: ticksWithVolumeArr,
        };
      }

      const pricePosition: DexPoolPricePosition = {
        currentTick,
        tickSpacing,
        currentTickSpacingRange: {
          lowerBound: tickSpacingLowerBound,
          upperBound: tickSpacingUpperBound,
          tickPositionInSpacing: tickPositionText,
          description,
        },
        priceInfo: {
          currentPrice: currentPriceString,
          currentPriceNumber: currentPrice,
          lowerBoundPrice: lowerBoundPrice.toFixed(18),
          upperBoundPrice: upperBoundPrice.toFixed(18),
          priceRange: priceRange.toFixed(18),
          pricePositionInRange: pricePositionText,
        },
        feeContext: {
          tickSpacingInBps: tickSpacing,
          approximateFeePercentage: (tickSpacing * 0.01).toFixed(2) + '%',
        },
        activeTicksContext,
      };

      // Aggregate recent active ticks (similar to MCP getDexPools)
      const recentActiveTicks: DexPoolActiveTick[] = [];

      const snapshotsSorted =
        latest.snapshots?.slice().sort((a, b) => {
          const at = new Date(a.timestampMs).getTime();
          const bt = new Date(b.timestampMs).getTime();
          return bt - at;
        }) ?? [];

      const last10MinSnapshots = snapshotsSorted.slice(0, 10);

      const tickVolumeMap = new Map<
        string,
        {
          totalVolume: number;
          latestApy: string;
          token0AmountUsd: string;
          token1AmountUsd: string;
        }
      >();

      for (const s of last10MinSnapshots) {
        for (const t of s.ticks || []) {
          const volume = this.parseNumber(t.tradingVolume) || 0;
          if (volume <= 0) continue;

          const existing = tickVolumeMap.get(t.tick);
          if (existing) {
            existing.totalVolume += volume;
          } else {
            tickVolumeMap.set(t.tick, {
              totalVolume: volume,
              latestApy: t.apy,
              token0AmountUsd: t.token0AmountUsd,
              token1AmountUsd: t.token1AmountUsd,
            });
          }
        }
      }

      for (const [tick, data] of tickVolumeMap.entries()) {
        recentActiveTicks.push({
          tick,
          tradingVolume: data.totalVolume.toFixed(2),
          apy: data.latestApy,
          token0AmountUsd: data.token0AmountUsd,
          token1AmountUsd: data.token1AmountUsd,
        });
      }

      recentActiveTicks.sort(
        (a, b) =>
          (this.parseNumber(b.tradingVolume) || 0) -
          (this.parseNumber(a.tradingVolume) || 0),
      );

      const poolData: DexPoolData = {
        currentSnapshot,
        pricePosition,
        recentActiveTicks,
        totalTVL: snap.tvl,
        fee: snap.fee,
        tickSpacing: snap.tickSpacing,
      };

      dexPools[poolAddress] = poolData;
    }

    dexPools._dataSource = 'tracker_service';

    return dexPools;
  }

  private async fetchOpportunities(
    deployment: UserDeployment,
    chainId: ChainId,
    totalAssetsUsd: number,
  ) {
    const lpSimulations: GetLpSimulateResponse[] = [];
    const supplyOpportunities: GetSupplyOpportunitiesResponse[] = [];
    let dexPools: GetDexPoolsResponse = {};

    try {
      const poolSnapshotCachesList =
        await this.trackerService.getPoolSnapshotCachesList(
          getNetworkDto(Number(chainId)),
        );

      dexPools = this.convertPoolSnapshotsToDexPools(poolSnapshotCachesList);

      this.logger.log(`get_dex_pools response: ${JSON.stringify(dexPools)}`);

      const lpRequests = this.buildLpSimulateRequests(
        chainId,
        dexPools,
        totalAssetsUsd,
      );
      if (lpRequests.length > 0) {
        const simulationsRaw =
          await this.apyCalculator.simulateLpWithTrackerBatch(lpRequests);
        this.logger.log(
          `get_lp_simulate_batch response: ${JSON.stringify(simulationsRaw)}`,
        );
        const simulations =
          this.normalizeDictionaryResponse<GetLpSimulateResponse>(
            simulationsRaw,
          );
        lpSimulations.push(...simulations);
      }
    } catch (error) {
      this.logger.warn(`LP simulation failed: ${error.message}`);
    }

    try {
      const supplyOpps =
        await this.agentService.callMcpTool<GetSupplyOpportunitiesResponse>(
          'get_supply_opportunities',
          {
            chain_id: chainId,
            amount: totalAssetsUsd,
            protocols: this.protocols.lendingProtocols,
          },
        );
      this.logger.log(
        `get_supply_opportunities response: ${JSON.stringify(supplyOpps)}`,
      );
      supplyOpportunities.push(supplyOpps);
    } catch (error) {
      this.logger.warn(
        `get_supply_opportunities failed: ${error.message}`,
        error.stack,
      );
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
    currentHoldings: Record<string, number>,
  ): Promise<StrategyCandidate[]> {
    // Store these for later use in strategy position enrichment
    this._cachedLpSimulations = lpSimulations;
    this._cachedDexPools = dexPools;
    const opportunities = this.opportunityConverter.convertToOpportunities(
      lpSimulations,
      supplyData,
      totalCapital,
      chainId,
      dexPools,
    );

    if (opportunities.length === 0) return [];

    this.logger.log(
      `Found ${opportunities.length} opportunities for optimization`,
    );

    // Log detailed opportunity info for AI agent to parse
    opportunities.forEach((opp, idx) => {
      const initialAPY = opp.getAPY(0);
      if (opp.type === 'lp') {
        const token0Symbol = this.getTokenSymbol(
          opp.token0Address,
          chainId,
          dexPools,
          opp.poolAddress,
          'token0',
        );
        const token1Symbol = this.getTokenSymbol(
          opp.token1Address,
          chainId,
          dexPools,
          opp.poolAddress,
          'token1',
        );
        this.logger.log(
          `Opportunity ${idx}: LP ${token0Symbol}/${token1Symbol} (${opp.poolAddress}) on ${opp.protocol}, initialAPY=${initialAPY.toFixed(2)}%`,
        );
      } else if (opp.type === 'supply') {
        this.logger.log(
          `Opportunity ${idx}: Supply ${opp.asset} on ${opp.protocol}, initialAPY=${initialAPY.toFixed(2)}%`,
        );
      }
    });

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
        name: 'Conservative',
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
          true,
        );

        if (result.positions.length === 0) continue;

        const strategyPositions = result.positions.map((pos) => {
          const basePosition = {
            type: pos.opportunity.type,
            protocol: pos.opportunity.protocol,
            amount: pos.amount,
            allocation: (pos.amount / result.totalInvested) * 100,
          };

          if (pos.opportunity.type === 'supply') {
            return {
              ...basePosition,
              asset: pos.opportunity.asset,
              vaultAddress: pos.opportunity.vaultAddress,
            };
          } else if (pos.opportunity.type === 'lp') {
            // Enrich LP position with token addresses, amounts, and ticks
            const lpInfo = this.findLpPositionInfo(
              pos.opportunity.poolAddress as string,
              this._cachedLpSimulations,
              this._cachedDexPools,
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
          `Failed to run ${config.name} optimization: ${error.message}`,
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
    positionStatus: PositionStatus,
    yieldSummary: AccountYieldSummaryResponse,
  ) {
    const constraints = this.getConstraintsByPositionStatus(positionStatus);
    const maxBreakEvenHours = constraints.maxBreakEvenHours;
    const minRelativeApyIncrease = constraints.minRelativeApyIncrease;
    const minAbsoluteApyIncrease = constraints.minAbsoluteApyIncrease;

    this.logger.log(
      `Evaluating strategies with constraints for ${positionStatus}: ` +
        `maxBreakEvenHours=${maxBreakEvenHours}h, ` +
        `minRelativeApyIncrease=${minRelativeApyIncrease}x, ` +
        `minAbsoluteApyIncrease=${minAbsoluteApyIncrease}pp`,
    );

    let gasEstimate = 0;
    let breakEvenTimeHours = 0;
    let netGainUsd = 0;
    let bestStrategy = allStrategies[0];
    const evaluationRecords: StrategyEvaluationRecord[] = [];

    try {
      const {
        balances: currentBalances,
        lendingPositions: currentLendingSupplyPositions,
        liquidityPositions: currentLiquidityPositions,
      } = this.buildCurrentPortfolioStateForRebalance(yieldSummary);

      const targetPositionsBatch = allStrategies.map((s) =>
        this.convertStrategyToTargetPositions(
          s.strategy,
          lpSimulations,
          supplyData,
          dexPools,
          chainId,
        ),
      );

      const request: CalculateSwapCostBatchRequest = {
        processed_args_batch: targetPositionsBatch.map(
          (positions): ProcessedRebalanceArgs => ({
            network: getNetworkDto(Number(chainId)),
            safeAddress: walletAddress,
            operator: walletAddress,
            wallet: walletAddress,
            currentBalances,
            currentLendingSupplyPositions,
            currentLiquidityPositions,
            targetLendingSupplyPositions:
              positions.targetLendingSupplyPositions || [],
            targetLiquidityPositions: positions.targetLiquidityPositions || [],
          }),
        ),
      };

      const costResult =
        await this.owliaGuardService.getRebalanceCostFromProcessedArgsBatch(
          request,
        );

      this.logger.log(
        `calculate_rebalance_cost_batch response: ${JSON.stringify(costResult)}`,
      );

      const resultsArray =
        this.normalizeDictionaryResponse<CalculateRebalanceCostResult>(
          costResult,
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

        // Log detailed strategy analysis for AI agent
        const apyIncreasePercent =
          portfolioApy > 0
            ? ((strategyApy - portfolioApy) / portfolioApy) * 100
            : 0;

        this.logger.log(
          `Strategy ${index} (${allStrategies[index].name}): ` +
            `APY=${strategyApy.toFixed(2)}%, swap_fee=$${swapFee.toFixed(4)}, ` +
            `break-even=${breakEven.toFixed(2)}h, score=${score.toFixed(4)}, ` +
            `apyIncrease=${apyImprovement.toFixed(2)}pp (+${apyIncreasePercent.toFixed(2)}%)`,
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
          `No strategy meets breakeven time constraint (all > ${maxBreakEvenHours}h)`,
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
    evaluationRecords?: StrategyEvaluationRecord[],
  ): RebalancePrecheckResult {
    const opportunityApy = bestStrategy.apy;
    const relativeIncrease =
      portfolioApy > 0 ? opportunityApy / portfolioApy : Infinity;
    const absoluteIncrease = opportunityApy - portfolioApy;

    const constraints = this.getConstraintsByPositionStatus(positionStatus);

    // Note: breakEvenTimeHours constraint is already checked in evaluateStrategies()

    // For LP_IN_RANGE, do not rebalance
    // For other statuses, check both relative (10%) and absolute (2pp) increase
    let meetsApyConstraint = false;

    if (positionStatus === PositionStatus.LP_IN_RANGE) {
      this.logger.log(
        `Precheck REJECTED for user ${userId}: LP position is in range, no rebalancing needed`,
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
        failureReason: 'LP position is in range',
        strategyEvaluations: evaluationRecords,
      };
    } else {
      meetsApyConstraint =
        relativeIncrease >= constraints.minRelativeApyIncrease &&
        absoluteIncrease >= constraints.minAbsoluteApyIncrease;
    }

    if (!meetsApyConstraint) {
      this.logger.log(
        `Precheck REJECTED (${positionStatus}): APY conditions not met. ` +
          `Relative=${relativeIncrease.toFixed(2)}x, Absolute=${absoluteIncrease.toFixed(2)}pp, ` +
          `Required: relative>=${constraints.minRelativeApyIncrease}x, absolute>=${constraints.minAbsoluteApyIncrease}pp`,
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
    const apyIncreasePercent =
      portfolioApy > 0
        ? ((opportunityApy - portfolioApy) / portfolioApy) * 100
        : 0;
    const apyIncreasePercentagePoints = opportunityApy - portfolioApy;

    this.logger.log(
      `Precheck APPROVED for user ${userId}: ` +
        `Portfolio APY=${portfolioApy.toFixed(2)}%, Opportunity APY=${opportunityApy.toFixed(2)}%, ` +
        `APY Increase=${apyIncreasePercentagePoints.toFixed(2)}pp (+${apyIncreasePercent.toFixed(2)}%), ` +
        `Strategy=${bestStrategy.name}, ${strategyDetails}`,
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
    currentHoldings?: Record<string, number>,
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
    amount: number,
  ): GetLpSimulateRequest[] {
    if (!dexPools || typeof dexPools !== 'object') return [];

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
          operation: 'add',
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
    chainId: string,
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
      if (position.type === 'supply') {
        const supplyTokenAddress = lookupTokenAddress(
          position.asset as string,
          chainId,
        );
        targetLendingSupplyPositions.push({
          protocol: this.normalizeProtocolType(position.protocol),
          token: supplyTokenAddress as string,
          vToken: position.vaultAddress as string,
          amount: position.amount.toString(),
        });
      } else if (position.type === 'lp') {
        const lpInfo = this.findLpPositionInfo(
          position.poolAddress as string,
          lpSimulations,
          dexPools,
        );
        if (lpInfo) {
          const allocationRatio = position.allocation
            ? position.allocation / 100
            : 1;
          targetLiquidityPositions.push({
            protocol: this.normalizeLpProtocol(position.protocol),
            poolAddress: position.poolAddress as string,
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
    dexPools: Record<string, any>,
  ) {
    const normalizedPoolAddress = poolAddress;

    let token0Amount = 0,
      token1Amount = 0,
      tickLower = 0,
      tickUpper = 0;
    for (const sim of lpSimulations) {
      if (sim.pool?.poolAddress === normalizedPoolAddress) {
        token0Amount =
          this.parseNumber(sim.summary?.requiredTokens?.token0?.amount) || 0;
        token1Amount =
          this.parseNumber(sim.summary?.requiredTokens?.token1?.amount) || 0;
        tickLower = sim.pool?.position?.tickLower ?? 0;
        tickUpper = sim.pool?.position?.tickUpper ?? 0;
        break;
      }
    }

    let token0Address = '',
      token1Address = '';
    for (const [poolAddr, poolData] of Object.entries(dexPools)) {
      if (poolAddr === normalizedPoolAddress) {
        const snap = poolData?.currentSnapshot || {};
        token0Address = snap.token0Address || snap.token0 || '';
        token1Address = snap.token1Address || snap.token1 || '';
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
    if (normalized === 'aave' || normalized === 'aavev3') return 'aave';
    if (normalized === 'euler' || normalized === 'eulerv2') return 'euler';
    if (normalized === 'venus' || normalized === 'venusv4') return 'venus';
    return 'aave';
  }

  private normalizeLpProtocol(
    protocol: string | undefined,
  ): 'uniswapV3' | 'aerodromeSlipstream' {
    if (!protocol) throw new Error('LP protocol required');
    const normalized = protocol.toLowerCase();
    if (normalized.includes('uniswap')) return 'uniswapV3';
    if (normalized.includes('aerodrome')) return 'aerodromeSlipstream';
    throw new Error(`Invalid LP protocol: "${protocol}"`);
  }

  private formatStrategyDetails(strategy: Strategy): string {
    if (!strategy.positions || strategy.positions.length === 0) {
      return 'No positions';
    }

    const details = strategy.positions
      .map((pos) => {
        const amountStr = `$${pos.amount.toFixed(2)}`;
        const allocStr = `${pos.allocation.toFixed(1)}%`;
        if (pos.type === 'supply') {
          return `${pos.asset}(supply/${pos.protocol}): ${amountStr} (${allocStr})`;
        } else {
          const poolShort = pos.poolAddress
            ? pos.poolAddress.slice(0, 8)
            : 'unknown';

          // Try to get token pair info from cached data
          let pairInfo = '';
          if (pos.poolAddress && this._cachedDexPools) {
            const token0Symbol = this.getTokenSymbol(
              pos.token0Address,
              this._cachedLpSimulations[0]?.pool?.poolAddress
                ? (this._cachedLpSimulations[0] as any).chainId || '56'
                : '56',
              this._cachedDexPools,
              pos.poolAddress,
              'token0',
            );
            const token1Symbol = this.getTokenSymbol(
              pos.token1Address,
              this._cachedLpSimulations[0]?.pool?.poolAddress
                ? (this._cachedLpSimulations[0] as any).chainId || '56'
                : '56',
              this._cachedDexPools,
              pos.poolAddress,
              'token1',
            );
            if (
              token0Symbol &&
              token1Symbol &&
              token0Symbol !== 'UNKNOWN' &&
              token1Symbol !== 'UNKNOWN'
            ) {
              pairInfo = ` ${token0Symbol}/${token1Symbol}`;
            }
          }

          return `${poolShort}${pairInfo}(lp/${pos.protocol}): ${amountStr} (${allocStr})`;
        }
      })
      .join(', ');

    return details;
  }

  private parseNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const sanitized = value.replace(/[%,$]/g, '').trim();
      const parsed = Number(sanitized);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  }

  private logRebalanceSwapPlan(
    result: CalculateRebalanceCostResult,
    chainId: string,
    index: number,
  ): void {
    const swapSummaries = this.describeSwapRoutes(result, chainId);
    if (swapSummaries.length === 0) {
      return;
    }

    const safe = result.details?.safe ?? 'unknown';
    this.logger.log(
      `Strategy ${index} swap plan (safe ${safe}): ${swapSummaries.join(' | ')}`,
    );
  }

  private describeSwapRoutes(
    result: CalculateRebalanceCostResult,
    chainId: string,
  ): string[] {
    const details = result.details;
    if (!details || !Array.isArray(details.routes)) {
      return [];
    }

    return details.routes
      .filter((route) => route?.actionType === 'Swap')
      .map((route) => this.formatSwapRoute(route, chainId))
      .filter((summary): summary is string => Boolean(summary));
  }

  private formatSwapRoute(
    route: RebalanceRoute,
    chainId: string,
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
          toMeta?.decimals ?? fromMeta.decimals,
        )
      : null;

    const protocol = route.protocol || 'unknown';
    const outputPart =
      amountOut && toMeta ? ` -> ${amountOut} ${toMeta.symbol}` : '';

    return `Swap ${amountIn} ${fromMeta.symbol}${outputPart} via ${protocol}`;
  }

  private getTokenSymbol(
    tokenAddress: string | undefined,
    chainId: string,
    dexPools: Record<string, any>,
    poolAddress?: string,
    tokenKey?: 'token0' | 'token1',
  ): string {
    if (!tokenAddress) return 'UNKNOWN';

    // First try to get from dexPools if poolAddress is provided
    if (poolAddress && tokenKey && dexPools) {
      const normalizedPoolAddress = poolAddress;
      for (const [poolAddr, poolData] of Object.entries(dexPools)) {
        if (poolAddr === '_dataSource') continue;
        if (poolAddr === normalizedPoolAddress) {
          const currentSnapshot = poolData?.currentSnapshot;
          const symbolKey = `${tokenKey}Symbol`;
          if (currentSnapshot && currentSnapshot[symbolKey]) {
            return currentSnapshot[symbolKey];
          }
        }
      }
    }

    // Fallback to lookupTokenSymbol
    const symbol = lookupTokenSymbol(tokenAddress, chainId);
    if (symbol) return symbol;

    // Last resort: return shortened address
    return tokenAddress.startsWith('0x')
      ? `${tokenAddress.slice(0, 6)}...`
      : tokenAddress;
  }

  private resolveTokenMeta(
    tokenIdentifier: string,
    chainId: string,
  ): { symbol: string; decimals: number } {
    const symbol =
      lookupTokenSymbol(tokenIdentifier, chainId) ??
      (tokenIdentifier?.startsWith('0x')
        ? `${tokenIdentifier.slice(0, 6)}...`
        : tokenIdentifier);

    const decimalsMap = TOKEN_DECIMALS_BY_CHAIN[chainId] || {};
    const decimals = symbol
      ? (decimalsMap[symbol.replace('...', '').toUpperCase()] ?? 18)
      : 18;

    return { symbol: symbol || 'unknown', decimals };
  }

  private formatTokenAmount(amount: string | number, decimals: number): string {
    if (amount === null || amount === undefined) {
      return '0';
    }

    if (typeof amount === 'number') {
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
        .padStart(decimals, '0')
        .replace(/0+$/, '');
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
    if (typeof data === 'object') {
      const entries = Object.entries(data).filter(
        ([key]) => key !== '_dataSource',
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
