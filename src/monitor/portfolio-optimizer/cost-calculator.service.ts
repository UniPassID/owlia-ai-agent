import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { AgentService } from "../../agent/agent.service";
import {
  CalculateSwapCostBatchRequest,
  CalculateRebalanceCostBatchResponse,
  CalculateRebalanceCostResult,
  GetLpSimulateResponse,
  GetSupplyOpportunitiesResponse,
  ProcessedRebalanceArgs,
} from "../../agent/types/mcp.types";
import { Opportunity } from "./types";
import {
  lookupTokenSymbol,
  TOKEN_ADDRESS_BY_CHAIN,
  TOKEN_DECIMALS_BY_CHAIN,
} from "../../agent/token-utils";

const CHAIN_ID_TO_NETWORK: Record<string, string> = {
  "1": "ethereum",
  "10": "optimism",
  "56": "bsc",
  "137": "polygon",
  "42161": "arbitrum",
  "8453": "base",
};

interface StableTokenInfo {
  symbol: string;
  address: string;
  decimals: number;
}

interface CachedSwapCostEntry {
  baseAmountUsd: number;
  costUsd: number;
}

interface SwapCostCacheEntry {
  matrix: Record<string, Record<string, CachedSwapCostEntry>>;
  updatedAt: number;
}

interface SwapCostRequestPayload {
  args: ProcessedRebalanceArgs;
  sourceSymbol: string;
  targetSymbol: string;
}

interface SwapCostComputationResult {
  cost: number;
  sourceSymbol: string | null;
  usedDynamic: boolean;
}

@Injectable()
export class CostCalculatorService {
  private readonly logger = new Logger(CostCalculatorService.name);
  private readonly swapCostBaseAmountUsd = 10_000;
  private readonly swapCostTtlMs = 15 * 60 * 1000;
  private readonly swapCostCache = new Map<string, SwapCostCacheEntry>();
  private readonly trackedSwapCostChains = new Set<string>();
  private readonly refreshingSwapChains = new Set<string>();
  private readonly missingStableTokenChains = new Set<string>();
  private readonly missingNetworkChains = new Set<string>();
  private readonly swapCostSafeAddress =
    "0x0000000000000000000000000000000000000001";

  constructor(private readonly agentService: AgentService) {}

  private warnOnce(set: Set<string>, key: string, message: string): void {
    if (set.has(key)) return;
    this.logger.warn(message);
    set.add(key);
  }

  private deductHolding(
    holdings: Map<string, number>,
    symbol: string,
    amount: number
  ): void {
    const current = holdings.get(symbol) ?? 0;
    holdings.set(symbol, Math.max(0, current - amount));
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  private async refreshTrackedSwapCosts(): Promise<void> {
    if (this.trackedSwapCostChains.size === 0) {
      return;
    }

    for (const chainId of Array.from(this.trackedSwapCostChains)) {
      try {
        await this.refreshSwapCostData(chainId);
      } catch (error) {
        this.logger.warn(
          `Scheduled swap cost refresh failed for chain ${chainId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private async ensureSwapCostData(chainId: string): Promise<void> {
    if (!chainId) return;

    this.trackedSwapCostChains.add(chainId);
    await this.refreshSwapCostData(chainId);
  }

  private async refreshSwapCostData(
    chainId: string,
    force: boolean = false
  ): Promise<void> {
    if (!chainId || this.refreshingSwapChains.has(chainId)) {
      return;
    }

    const cacheEntry = this.swapCostCache.get(chainId);
    const isStale =
      !cacheEntry || Date.now() - cacheEntry.updatedAt > this.swapCostTtlMs;
    if (!force && !isStale) {
      return;
    }

    const stableTokens = this.getStableTokensForChain(chainId);
    if (stableTokens.length < 2) {
      this.warnOnce(
        this.missingStableTokenChains,
        chainId,
        `No stable token definitions found for chain ${chainId}, falling back to static swap costs`
      );
      return;
    }

    const swapRequests = this.buildSwapCostRequests(chainId, stableTokens);
    if (swapRequests.length === 0) {
      return;
    }

    this.refreshingSwapChains.add(chainId);

    try {
      const payload: CalculateSwapCostBatchRequest = {
        processed_args_batch: swapRequests.map((req) => req.args),
      };

      this.logger.log(
        `calculate_swap_cost_batch payload: ${JSON.stringify(payload)}`
      );

      const response =
        await this.agentService.callMcpTool<CalculateRebalanceCostBatchResponse>(
          "calculate_swap_cost_batch",
          payload
        );

      const results =
        this.normalizeDictionaryResponse<CalculateRebalanceCostResult>(
          response
        );
      const matrix: Record<string, Record<string, CachedSwapCostEntry>> = {};

      results.forEach((result, index) => {
        const request = swapRequests[index];
        if (!request) {
          return;
        }

        const costUsd = this.parseNumber(result?.fee);

        if (costUsd === null || costUsd === undefined) {
          return;
        }

        const sourceSymbol = request.sourceSymbol;
        const targetSymbol = request.targetSymbol;

        matrix[sourceSymbol] = matrix[sourceSymbol] || {};
        matrix[sourceSymbol][targetSymbol] = {
          baseAmountUsd: this.swapCostBaseAmountUsd,
          costUsd,
        };
      });

      if (Object.keys(matrix).length === 0) {
        this.logger.warn(
          `Swap cost refresh for chain ${chainId} returned no usable entries`
        );
        return;
      }

      this.swapCostCache.set(chainId, {
        matrix,
        updatedAt: Date.now(),
      });

      const pairCount = Object.values(matrix).reduce(
        (sum, row) => sum + Object.keys(row).length,
        0
      );
      this.logger.log(
        `Refreshed swap cost cache for chain ${chainId}: ${pairCount} pairs`
      );
    } catch (error) {
      this.logger.warn(
        `Failed to refresh swap cost cache for chain ${chainId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      this.refreshingSwapChains.delete(chainId);
    }
  }

  private buildSwapCostRequests(
    chainId: string,
    stableTokens: StableTokenInfo[]
  ): SwapCostRequestPayload[] {
    const network = this.getNetworkName(chainId);
    if (!network) {
      this.warnOnce(
        this.missingNetworkChains,
        chainId,
        `No network mapping found for chain ${chainId}, using static swap costs`
      );
      return [];
    }

    const protocol = this.getDefaultLendingProtocol(chainId);
    const requests: SwapCostRequestPayload[] = [];

    for (const from of stableTokens) {
      for (const to of stableTokens) {
        if (from === to || !from.address || !to.address) continue;

        const amountIn = this.usdToTokenUnits(
          this.swapCostBaseAmountUsd,
          from.decimals
        );
        const amountOut = this.usdToTokenUnits(
          this.swapCostBaseAmountUsd,
          to.decimals
        );
        if (amountIn === "0" || amountOut === "0") continue;

        requests.push({
          args: {
            network,
            safeAddress: this.swapCostSafeAddress,
            operator: this.swapCostSafeAddress,
            wallet: this.swapCostSafeAddress,
            currentBalances: [
              { token: from.address, amount: amountIn },
              { token: to.address, amount: "0" },
            ],
            currentLendingSupplyPositions: [],
            currentLiquidityPositions: [],
            targetLendingSupplyPositions: [
              {
                protocol,
                token: to.address,
                vToken: null,
                amount: amountOut,
              },
            ],
            targetLiquidityPositions: [],
          },
          sourceSymbol: from.symbol.toUpperCase(),
          targetSymbol: to.symbol.toUpperCase(),
        });
      }
    }

    return requests;
  }

  private getNetworkName(chainId: string): string | null {
    return CHAIN_ID_TO_NETWORK[chainId] || null;
  }

  private getDefaultLendingProtocol(
    chainId: string
  ): "aave" | "euler" | "venus" {
    if (chainId === "56") {
      return "venus";
    }
    return "aave";
  }

  private usdToTokenUnits(amountUsd: number, decimals: number): string {
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || decimals < 0) {
      return "0";
    }

    const scale = BigInt(10) ** BigInt(decimals);
    const scaledUsd = BigInt(Math.round(amountUsd * 1_000_000));
    return ((scale * scaledUsd) / BigInt(1_000_000)).toString();
  }

  private getStableTokensForChain(chainId: string): StableTokenInfo[] {
    const chainTokens = TOKEN_ADDRESS_BY_CHAIN[chainId];
    const chainDecimals = TOKEN_DECIMALS_BY_CHAIN[chainId] || {};
    if (!chainTokens) {
      return [];
    }

    return Object.entries(chainTokens)
      .filter(
        ([, address]) => typeof address === "string" && address.length > 0
      )
      .map(([symbol, address]) => ({
        symbol: symbol.toUpperCase(),
        address,
        decimals:
          typeof chainDecimals[symbol] === "number"
            ? chainDecimals[symbol]
            : 18,
      }));
  }

  private getStableSymbolsForChain(chainId: string): string[] {
    return this.getStableTokensForChain(chainId).map((token) =>
      token.symbol.toUpperCase()
    );
  }

  public createStableHoldingsMap(
    chainId: string,
    holdings: Record<string, number>
  ): Map<string, number> {
    const stableSymbols = this.getStableSymbolsForChain(chainId);
    const normalizedHoldings = this.normalizeHoldings(holdings);
    const map = new Map<string, number>();

    stableSymbols.forEach((symbol) => {
      map.set(symbol, normalizedHoldings.get(symbol) || 0);
    });

    return map;
  }

  public async estimateSwapCostForToken(
    chainId: string,
    targetSymbol: string,
    amountUsd: number,
    options?: {
      availableStableHoldings?: Map<string, number>;
      holdingsSnapshot?: Record<string, number>;
    }
  ): Promise<SwapCostComputationResult> {
    if (!amountUsd || amountUsd <= 0) {
      return { cost: 0, sourceSymbol: null, usedDynamic: false };
    }

    const normalizedTarget = (targetSymbol || "").toUpperCase();
    const stableSymbols = this.getStableSymbolsForChain(chainId);

    let availableStableHoldings = options?.availableStableHoldings;
    if (!availableStableHoldings) {
      availableStableHoldings = this.createStableHoldingsMap(
        chainId,
        options?.holdingsSnapshot || {}
      );
    }

    if (stableSymbols.length < 2 || !stableSymbols.includes(normalizedTarget)) {
      return {
        cost: this.calculateStaticSwapCost(amountUsd),
        sourceSymbol: null,
        usedDynamic: false,
      };
    }

    const sourceSymbol = this.selectSourceStableToken(
      normalizedTarget,
      availableStableHoldings,
      stableSymbols
    );

    if (!sourceSymbol || sourceSymbol === normalizedTarget) {
      return {
        cost: this.calculateStaticSwapCost(amountUsd),
        sourceSymbol: sourceSymbol ?? null,
        usedDynamic: false,
      };
    }

    const dynamicCost = await this.getDynamicSwapCost(
      chainId,
      sourceSymbol,
      normalizedTarget,
      amountUsd
    );

    // Update holdings regardless of cost calculation method
    this.deductHolding(availableStableHoldings, sourceSymbol, amountUsd);

    return {
      cost: dynamicCost,
      sourceSymbol,
      usedDynamic: true,
    };
  }

  private normalizeHoldings(
    holdings: Record<string, number>
  ): Map<string, number> {
    const map = new Map<string, number>();
    if (!holdings) {
      return map;
    }

    for (const [symbol, amount] of Object.entries(holdings)) {
      if (typeof amount !== "number" || !Number.isFinite(amount)) {
        continue;
      }
      map.set(symbol.toUpperCase(), amount);
    }

    return map;
  }

  private selectSourceStableToken(
    targetSymbol: string,
    availableStableHoldings: Map<string, number>,
    stableSymbols: string[]
  ): string | null {
    const candidates = stableSymbols.filter((s) => s !== targetSymbol);
    if (candidates.length === 0) return null;

    // Select token with largest holding
    return candidates.reduce((best, symbol) => {
      const amount = availableStableHoldings.get(symbol) ?? 0;
      const bestAmount = availableStableHoldings.get(best) ?? 0;
      return amount > bestAmount ? symbol : best;
    });
  }

  private async getDynamicSwapCost(
    chainId: string,
    sourceSymbol: string,
    targetSymbol: string,
    amountUsd: number
  ): Promise<number | null> {
    await this.ensureSwapCostData(chainId);
    const cacheEntry = this.swapCostCache.get(chainId);
    if (!cacheEntry) {
      return null;
    }

    const sourceMap = cacheEntry.matrix[sourceSymbol];
    const entry = sourceMap?.[targetSymbol];
    if (!entry || entry.baseAmountUsd <= 0) {
      return null;
    }

    const scaledCost = (entry.costUsd * amountUsd) / entry.baseAmountUsd;
    if (!Number.isFinite(scaledCost)) {
      throw new Error(`scaledCost is infinite, ${scaledCost}`);
    }

    if (scaledCost < 0) {
      this.logger.warn(
        `scaledCost is negative ${scaledCost}, will return 0 instead`
      );
      return 0;
    }

    return scaledCost;
  }

  /**
   * Get target tokens and amounts needed for an opportunity
   * Public so that marginal-optimizer can update simulated holdings
   */
  getTargetTokensForOpportunity(
    opp: Opportunity,
    amount: number,
    chainId: string,
    lpSimulations: GetLpSimulateResponse[],
    supplyData: GetSupplyOpportunitiesResponse[],
    dexPools: Record<string, any>
  ): Array<{ symbol: string; amount: number }> {
    if (opp.type === "supply") {
      // Supply position needs single token
      return [{ symbol: opp.asset || "UNKNOWN", amount }];
    } else if (opp.type === "lp") {
      // LP position needs two tokens
      const lpInfo = this.findLpPositionInfo(
        opp.poolAddress!,
        lpSimulations,
        dexPools
      );
      if (!lpInfo) return [];

      const totalValue = lpInfo.token0Amount + lpInfo.token1Amount;
      const allocationRatio = totalValue > 0 ? amount / totalValue : 0;

      // Get token symbols from addresses
      const token0Symbol = this.getTokenSymbolFromAddress(
        lpInfo.token0Address,
        chainId,
        dexPools
      );
      const token1Symbol = this.getTokenSymbolFromAddress(
        lpInfo.token1Address,
        chainId,
        dexPools
      );

      return [
        { symbol: token0Symbol, amount: lpInfo.token0Amount * allocationRatio },
        { symbol: token1Symbol, amount: lpInfo.token1Amount * allocationRatio },
      ];
    }

    return [];
  }

  /**
   * Static fallback swap cost estimation (DEX fee + slippage)
   * Used when dynamic data is unavailable.
   */
  private calculateStaticSwapCost(amount: number): number {
    // Base DEX fee (e.g., 0.01% for Uniswap V3, 0.01% for some pools)
    const dexFeeRate = 0.0001; // 0.01%
    const dexFee = amount * dexFeeRate;

    // Simplified slippage estimation
    // In reality, this should consider pool liquidity, but we'll use a simple model
    // Slippage increases with trade size relative to typical pool volume
    const slippageRate = Math.min(0.002, amount / 100000); // 0.2% max, scales with amount
    const slippage = amount * slippageRate;

    return dexFee + slippage;
  }

  /**
   * Get token symbol from address using token-utils lookup
   */
  private getTokenSymbolFromAddress(
    address: string,
    chainId: string,
    dexPools: Record<string, any>
  ): string {
    // First try: Use token-utils lookup (canonical source)
    const symbol = lookupTokenSymbol(address, chainId);
    if (symbol) {
      return symbol;
    }

    // Second try: Search through DEX pools data
    const normalizedAddress = address.toLowerCase();
    for (const poolData of Object.values(dexPools)) {
      const snapshot = poolData?.currentSnapshot || {};

      if (snapshot.token0Address?.toLowerCase() === normalizedAddress) {
        return snapshot.token0Symbol || snapshot.token0 || address.slice(0, 8);
      }

      if (snapshot.token1Address?.toLowerCase() === normalizedAddress) {
        return snapshot.token1Symbol || snapshot.token1 || address.slice(0, 8);
      }
    }

    // Fallback: Return shortened address
    return address.slice(0, 8);
  }

  private findLpPositionInfo(
    poolAddress: string,
    lpSimulations: GetLpSimulateResponse[],
    dexPools: Record<string, any>
  ): {
    token0Address: string;
    token1Address: string;
    token0Amount: number;
    token1Amount: number;
    tickLower: number;
    tickUpper: number;
  } | null {
    const normalizedPoolAddress = poolAddress.toLowerCase();

    let token0Amount = 0;
    let token1Amount = 0;
    let tickLower = 0;
    let tickUpper = 0;

    for (const sim of lpSimulations) {
      const simPoolAddress = sim.pool?.poolAddress?.toLowerCase();
      if (simPoolAddress === normalizedPoolAddress) {
        token0Amount =
          this.parseNumber(sim.summary?.requiredTokens?.token0?.amount) || 0;
        token1Amount =
          this.parseNumber(sim.summary?.requiredTokens?.token1?.amount) || 0;
        tickLower = sim.pool?.position?.tickLower ?? 0;
        tickUpper = sim.pool?.position?.tickUpper ?? 0;
        break;
      }
    }

    let token0Address = "";
    let token1Address = "";
    for (const [poolAddr, poolData] of Object.entries(dexPools)) {
      if (poolAddr.toLowerCase() === normalizedPoolAddress) {
        const currentSnapshot = poolData?.currentSnapshot || {};
        token0Address =
          currentSnapshot.token0Address || currentSnapshot.token0 || "";
        token1Address =
          currentSnapshot.token1Address || currentSnapshot.token1 || "";
        break;
      }
    }

    if (
      !token0Address ||
      !token1Address ||
      (token0Amount === 0 && token1Amount === 0)
    ) {
      return null;
    }

    return {
      token0Address,
      token1Address,
      token0Amount,
      token1Amount,
      tickLower,
      tickUpper,
    };
  }

  private estimateSwapCostFallback(
    amount: number,
    hasExistingPosition: boolean
  ): number {
    const gasCost = hasExistingPosition ? 0 : 5;
    const swapFeeRate = 0.004;
    const variableCost = amount * swapFeeRate;
    return gasCost + variableCost;
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

  private normalizeDictionaryResponse<T>(data: any): T[] {
    if (!data) return [];
    if (Array.isArray(data)) return data as T[];
    if (typeof data === "object") {
      const entries = Object.entries(data).filter(
        ([key]) => key !== "_dataSource"
      );
      if (entries.length === 0) return [];
      entries.sort((a, b) => {
        const aNum = Number(a[0]);
        const bNum = Number(b[0]);
        const aIsNum = !Number.isNaN(aNum);
        const bIsNum = !Number.isNaN(bNum);
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
