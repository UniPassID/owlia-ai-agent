import { Injectable, Logger } from '@nestjs/common';
import { AgentService } from '../../agent/agent.service';
import {
  ChainId,
  GetLpSimulateRequest,
  GetLpSimulateResponse,
  GetSupplyOpportunitiesResponse,
} from '../../agent/types/mcp.types';
import { APYFunctions } from './types';

@Injectable()
export class APYCalculatorService {
  private readonly logger = new Logger(APYCalculatorService.name);

  constructor(private readonly agentService: AgentService) {}

  /**
   * Create APY curve function for supply opportunities with real-time query support
   */
  createSupplyAPYFunctions(
    opp: any,
    baseAmount: number,
    chainId: string,
  ): APYFunctions {
    const baseAPY = this.parseNumber(opp.after?.supplyAPY) || 0;
    const asset = opp.asset;

    const apyCache = new Map<number, number>();
    apyCache.set(baseAmount, baseAPY);

    const syncFn = (amount: number): number => {
      if (amount <= 0) return 0;
      if (apyCache.has(amount)) return apyCache.get(amount)!;
      return this.estimateSupplyAPY(baseAPY, baseAmount, amount);
    };

    const asyncFn = async (amount: number): Promise<number> => {
      if (amount <= 0) return 0;
      if (apyCache.has(amount)) return apyCache.get(amount)!;

      const ratio = amount / baseAmount;
      if (ratio > 0.8 && ratio < 1.2) {
        const estimated = this.estimateSupplyAPY(baseAPY, baseAmount, amount);
        apyCache.set(amount, estimated);
        return estimated;
      }

      this.logger.log(`Querying real-time Supply APY for ${asset} at $${amount.toFixed(2)}`);
      const queriedAPY = await this.querySupplyAPYForAmount(asset, amount, chainId);
      if (queriedAPY > 0) {
        this.logger.log(
          `Got real-time APY: ${queriedAPY.toFixed(2)}% ` +
          `(vs estimated: ${this.estimateSupplyAPY(baseAPY, baseAmount, amount).toFixed(2)}%)`
        );
        apyCache.set(amount, queriedAPY);
        return queriedAPY;
      }

      const estimated = this.estimateSupplyAPY(baseAPY, baseAmount, amount);
      apyCache.set(amount, estimated);
      return estimated;
    };

    return { syncFn, asyncFn };
  }

  /**
   * Create APY curve function for LP opportunities with real-time query support
   */
  createLpAPYFunctions(
    sim: GetLpSimulateResponse,
    baseAmount: number,
    chainId: string,
  ): APYFunctions {
    const baseAPY = this.extractLpApy(sim);
    const poolLiquidity = this.parseNumber(sim.pool?.before?.totalLiquidityUSD) || 1000000;
    const poolAddress = sim.pool?.poolAddress || '';
    const currentTick = sim.pool?.position?.currentTick || 0;

    const apyCache = new Map<number, number>();
    apyCache.set(baseAmount, baseAPY);

    const syncFn = (amount: number): number => {
      if (amount <= 0) return 0;
      if (apyCache.has(amount)) return apyCache.get(amount)!;
      return this.estimateLpAPY(baseAPY, poolLiquidity, baseAmount, amount);
    };

    const asyncFn = async (amount: number): Promise<number> => {
      if (amount <= 0) return 0;
      if (apyCache.has(amount)) return apyCache.get(amount)!;

      const ratio = amount / baseAmount;
      if (ratio > 0.8 && ratio < 1.2) {
        const estimated = this.estimateLpAPY(baseAPY, poolLiquidity, baseAmount, amount);
        apyCache.set(amount, estimated);
        return estimated;
      }

      this.logger.log(
        `Querying real-time LP APY for pool ${poolAddress.substring(0, 10)}... at $${amount.toFixed(2)}`
      );
      const queriedAPY = await this.queryLpAPYForAmount(poolAddress, amount, chainId, currentTick);
      if (queriedAPY > 0) {
        this.logger.log(
          `Got real-time APY: ${queriedAPY.toFixed(2)}% ` +
          `(vs estimated: ${this.estimateLpAPY(baseAPY, poolLiquidity, baseAmount, amount).toFixed(2)}%)`
        );
        apyCache.set(amount, queriedAPY);
        return queriedAPY;
      }

      const estimated = this.estimateLpAPY(baseAPY, poolLiquidity, baseAmount, amount);
      apyCache.set(amount, estimated);
      return estimated;
    };

    return { syncFn, asyncFn };
  }

  private async querySupplyAPYForAmount(
    asset: string,
    amount: number,
    chainId: string,
  ): Promise<number> {
    try {
      const result = await this.agentService.callMcpTool<GetSupplyOpportunitiesResponse>(
        'get_supply_opportunities',
        { chain_id: chainId as ChainId, amount },
      );

      if (result.opportunities && Array.isArray(result.opportunities)) {
        const matchingOpp = result.opportunities.find(o => o.asset === asset);
        if (matchingOpp) {
          return this.parseNumber(matchingOpp.after?.supplyAPY) || 0;
        }
      }
      return 0;
    } catch (error) {
      this.logger.warn(`Failed to query supply APY for ${asset}: ${error.message}`);
      return 0;
    }
  }

  private async queryLpAPYForAmount(
    poolAddress: string,
    amount: number,
    chainId: string,
    currentTick: number,
  ): Promise<number> {
    try {
      const tickLower = Math.trunc(currentTick);
      const tickUpper = tickLower + 1;

      const request: GetLpSimulateRequest = {
        chain_id: chainId as ChainId,
        poolOperation: {
          poolAddress,
          operation: 'add',
          amountUSD: amount,
          tickLower,
          tickUpper,
          timeHorizon: 30,
        },
        priceImpact: false,
        includeIL: true,
      };

      const result = await this.agentService.callMcpTool<any>('get_lp_simulate_batch', {
        reqs: [request],
      });

      const simulations = this.normalizeDictionaryResponse<GetLpSimulateResponse>(result);
      if (simulations.length > 0) {
        return this.extractLpApy(simulations[0]);
      }
      return 0;
    } catch (error) {
      this.logger.warn(`Failed to query LP APY for ${poolAddress}: ${error.message}`);
      return 0;
    }
  }

  private estimateSupplyAPY(baseAPY: number, baseAmount: number, targetAmount: number): number {
    if (targetAmount <= baseAmount) return baseAPY;
    const decayRate = 0.05;
    const ratio = targetAmount / baseAmount;
    const decayedAPY = baseAPY * Math.exp(-decayRate * (ratio - 1));
    return Math.max(decayedAPY, baseAPY * 0.5);
  }

  private estimateLpAPY(
    baseAPY: number,
    poolLiquidity: number,
    baseAmount: number,
    targetAmount: number,
  ): number {
    if (targetAmount <= 0) return 0;
    const newLiquidity = poolLiquidity + targetAmount;
    const liquidityRatio = poolLiquidity / newLiquidity;
    const scaledAPY = baseAPY * liquidityRatio * (baseAmount / targetAmount);
    return Math.max(scaledAPY, baseAPY * 0.3);
  }

  extractLpApy(simulation: GetLpSimulateResponse | null | undefined): number {
    if (!simulation) return 0;

    const candidateValues = [
      this.parseNumber(simulation.pool?.after?.estimatedAPY),
      this.parseNumber((simulation.pool?.after as any)?.afterAPY),
      this.parseNumber((simulation as any)?.afterAPY),
      this.parseNumber(simulation.summary?.totalExpectedAPY),
      this.parseNumber(simulation.pool?.before?.apy),
    ];

    for (const candidate of candidateValues) {
      if (candidate !== null) return candidate;
    }
    return 0;
  }

  parseNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const sanitized = value.replace(/[%,$]/g, '').trim();
      const parsed = Number(sanitized);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  }

  private normalizeDictionaryResponse<T>(data: any): T[] {
    if (!data) return [];
    if (Array.isArray(data)) return data as T[];
    if (typeof data === 'object') {
      const entries = Object.entries(data).filter(([key]) => key !== '_dataSource');
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
