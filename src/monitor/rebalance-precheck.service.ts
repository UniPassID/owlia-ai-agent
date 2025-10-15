import { Injectable, Logger } from '@nestjs/common';
import { AgentService } from '../agent/agent.service';
import { User } from '../entities/user.entity';
import { UserPolicy } from '../entities/user-policy.entity';
import {
  ActiveInvestmentsResponse,
  ChainId,
  GetLpSimulateRequest,
  GetLpSimulateResponse,
  GetSupplyOpportunitiesResponse,
  IdleAssetsResponse,
} from '../agent/types/mcp.types';

export interface RebalancePrecheckResult {
  shouldTrigger: boolean;
  portfolioApy: number;
  opportunityApy: number;
  differenceBps: number;
  totalPortfolioValueUsd: number;
  idleAssets: IdleAssetsResponse[];
  activeInvestments: ActiveInvestmentsResponse[];
}

@Injectable()
export class RebalancePrecheckService {
  private readonly logger = new Logger(RebalancePrecheckService.name);
  private readonly lpSimulationAmountUsd = 1000;
  private readonly lpSimulationTimeHorizonMinutes = 30;

  constructor(private readonly agentService: AgentService) {}

  async evaluate(user: User, policy: UserPolicy | null): Promise<RebalancePrecheckResult> {
    const chainId = this.normalizeChainId(user.chainId) as ChainId;

    const idleAssetsResults: IdleAssetsResponse[] = [];
    const activeInvestmentResults: ActiveInvestmentsResponse[] = [];
    const lpSimulationResults: GetLpSimulateResponse[] = [];
    const supplyOpportunitiesByChain: GetSupplyOpportunitiesResponse[] = [];

    try {
      const idle = await this.agentService.callMcpTool<IdleAssetsResponse>('get_idle_assets', {
        wallet_address: user.address,
        chain_id: chainId,
      });
      this.logger.log(`get_idle_assets result: ${JSON.stringify(idle)}`)
      idleAssetsResults.push(idle);
    } catch (error) {
      this.logger.warn(`get_idle_assets failed for user ${user.id} on chain ${chainId}: ${error.message}`);
    }

    try {
      const active = await this.agentService.callMcpTool<ActiveInvestmentsResponse>('get_active_investments', {
        wallet_address: user.address,
        chain_id: chainId,
      });
      this.logger.log(`get_active_investments result: ${JSON.stringify(active)}`)
      activeInvestmentResults.push(active);
    } catch (error) {
      this.logger.warn(`get_active_investments failed for user ${user.id} on chain ${chainId}: ${error.message}`);
    }

    const portfolioInfo = this.calculatePortfolioMetrics(idleAssetsResults, activeInvestmentResults);
    this.logger.log(`Portfolio summary for user ${user.id}: ${JSON.stringify(portfolioInfo)}`);

    try {
      const dexPools = await this.agentService.callMcpTool<Record<string, any>>('get_dex_pools', {
        chain_id: chainId,
      });
      const lpRequests = this.buildLpSimulateRequests(chainId, dexPools, portfolioInfo.totalValueUsd);
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
        amount: portfolioInfo.totalValueUsd,
      });
      this.logger.log(`Supply opportunities for user ${user.id}: ${JSON.stringify(supplyOpps)}`);
      supplyOpportunitiesByChain.push(supplyOpps);
    } catch (error) {
      this.logger.warn(`get_supply_opportunities failed for user ${user.id} on chain ${chainId}: ${error.message}`);
    }

    const opportunityApy = this.calculateOpportunityApy(lpSimulationResults, supplyOpportunitiesByChain);

    const difference = opportunityApy - portfolioInfo.apy;
    const differenceBps = difference * 100;
    const minLiftBps = policy?.minAprLiftBps ?? 50;

    const shouldTrigger = Number.isFinite(differenceBps)
      ? differenceBps >= minLiftBps
      : true;

    this.logger.log(
      `Precheck for user ${user.id}: portfolio APY=${portfolioInfo.apy.toFixed(2)}%, ` +
      `opportunity APY=${opportunityApy.toFixed(2)}%, diff=${differenceBps.toFixed(2)} bps, ` +
      `threshold=${minLiftBps} bps, total value=$${portfolioInfo.totalValueUsd.toFixed(2)} -> ${shouldTrigger ? 'trigger' : 'skip'}`,
    );

    return {
      shouldTrigger,
      portfolioApy: portfolioInfo.apy,
      opportunityApy,
      differenceBps,
      totalPortfolioValueUsd: portfolioInfo.totalValueUsd,
      idleAssets: idleAssetsResults,
      activeInvestments: activeInvestmentResults,
    };
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

  private calculatePortfolioMetrics(
    idleAssets: IdleAssetsResponse[],
    activeInvestments: ActiveInvestmentsResponse[],
  ): { apy: number; totalValueUsd: number } {
    const idleValue = idleAssets.reduce(
      (sum, response) => sum + this.extractIdleAssetsValue(response),
      0,
    );

    let totalActiveValue = 0;
    let weightedActiveYield = 0;
    const fallbackPositions: Array<{ value: number; apy: number }> = [];

    for (const investment of activeInvestments) {
      const { valueUsd, weightedApy } = this.extractActiveInvestmentMetrics(investment);
      if (valueUsd > 0) {
        totalActiveValue += valueUsd;
        weightedActiveYield += valueUsd * weightedApy;
      } else {
        fallbackPositions.push(...this.extractPositions(investment));
      }
    }

    if (totalActiveValue <= 0) {
      if (fallbackPositions.length === 0) {
        fallbackPositions.push(...this.extractPositions(activeInvestments));
      }
      const fallbackActiveValue = fallbackPositions.reduce((sum, pos) => sum + pos.value, 0);
      const fallbackYield = fallbackPositions.reduce((sum, pos) => sum + pos.value * pos.apy, 0);
      if (fallbackActiveValue > 0) {
        totalActiveValue = fallbackActiveValue;
        weightedActiveYield = fallbackYield;
      }
    }

    const totalValue = idleValue + totalActiveValue;
    if (totalValue <= 0) {
      return { apy: 0, totalValueUsd: 0 };
    }

    const portfolioYield = weightedActiveYield; // idle capital assumed 0% APY
    return {
      apy: portfolioYield / totalValue,
      totalValueUsd: totalValue,
    };
  }

  private extractIdleAssetsValue(response: IdleAssetsResponse | null | undefined): number {
    if (!response) {
      return 0;
    }

    const total = this.parseNumber(response.idleAssetsUsd);
    if (total !== null) {
      return total;
    }

    if (Array.isArray(response.assets)) {
      return response.assets.reduce((sum, asset) => {
        const value = this.parseNumber(asset?.balanceUsd);
        return sum + (value !== null ? value : 0);
      }, 0);
    }

    return this.aggregateIdleValue(response);
  }

  private extractActiveInvestmentMetrics(
    response: ActiveInvestmentsResponse | null | undefined,
  ): { valueUsd: number; weightedApy: number } {
    if (!response) {
      return { valueUsd: 0, weightedApy: 0 };
    }

    const value = this.parseNumber(response.activeInvestmentsUsd) || 0;
    const weightedApy = this.parseNumber(response.performanceSummary?.weightedApy) || 0;

    if (value > 0 && weightedApy > 0) {
      return { valueUsd: value, weightedApy };
    }

    // Fall back to aggregating detailed positions if summary data is missing
    const positions = this.extractPositions(response);
    const totalValue = positions.reduce((sum, pos) => sum + pos.value, 0);
    const totalYield = positions.reduce((sum, pos) => sum + pos.value * pos.apy, 0);

    if (totalValue > 0 && totalYield > 0) {
      return {
        valueUsd: totalValue,
        weightedApy: totalYield / totalValue,
      };
    }

    return { valueUsd: value, weightedApy };
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

    this.logger.log(`maxLpApy: ${maxLpApy}, maxSupplyApy: ${maxSupplyApy}`)

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

  private aggregateIdleValue(idleAssets: IdleAssetsResponse): number {
    if (!idleAssets) {
      return 0;
    }

    const total = this.findNumberDeep(idleAssets, [
      'totalValueUsd',
      'total_value_usd',
      'totalValue',
      'portfolioValueUsd',
      'netValueUsd',
      'idleAssetsUsd',
    ]);

    if (total !== null) {
      return total;
    }

    let sum = 0;
    this.walkStructure(idleAssets, (node) => {
      if (Array.isArray(node)) {
        for (const item of node) {
          const value = this.findNumberDirect(item, ['valueUsd', 'value_usd', 'usdValue', 'value']);
          if (value !== null) {
            sum += value;
          }
        }
      }
    });

    return sum;
  }

  private extractPositions(data: any): Array<{ value: number; apy: number }> {
    const positions: Array<{ value: number; apy: number }> = [];
    this.walkStructure(data, (node) => {
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        const value = this.findNumberDirect(node, [
          'valueUsd',
          'value_usd',
          'usdValue',
          'value',
          'netValueUsd',
          'principalUsd',
          'balanceUsd',
          'balance_usd',
          'supplyAmountUsd',
          'totalNetWorthUsd',
          'totalSupplyUsd',
          'depositedAmountUsd',
        ]);
        const apy = this.findNumberDirect(node, [
          'apy',
          'currentAPY',
          'currentApy',
          'apr',
          'aprPercent',
          'expectedAPY',
          'netApy',
          'weightedApy',
          'avgApy',
          'positionApy',
          'supplyApy',
          'totalApy',
        ]);

        if (value !== null && value > 0 && apy !== null) {
          positions.push({ value, apy });
        }
      }
    });
    return positions;
  }

  private extractMaxApy(data: GetSupplyOpportunitiesResponse): number {
    const maxApy = data.opportunities.reduce((prev, current) => {
      return Math.max(prev, current.after.supplyAPY)
    }, 0)

    return maxApy;
  }

  private findNumberDeep(source: any, keys: string[]): number | null {
    let result: number | null = null;
    this.walkStructure(source, (node) => {
      if (result !== null) {
        return;
      }
      if (node && typeof node === 'object' && !Array.isArray(node)) {
        const number = this.findNumberDirect(node, keys);
        if (number !== null) {
          result = number;
        }
      }
    });
    return result;
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
}
