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
} from '../agent/types/mcp.types';

export interface RebalancePrecheckResult {
  shouldTrigger: boolean;
  portfolioApy: number;
  opportunityApy: number;
  differenceBps: number;
  totalPortfolioValueUsd: number;
  yieldSummary?: AccountYieldSummaryResponse;
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
      const dexPools = await this.agentService.callMcpTool<Record<string, any>>('get_dex_pools', {
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

    const opportunityApy = this.calculateOpportunityApy(lpSimulationResults, supplyOpportunitiesByChain);

    const difference = opportunityApy - portfolioApy;
    const differenceBps = difference * 100;

    // New APY must satisfy BOTH conditions:
    // a) At least 10% higher than current portfolio APY
    // b) At least 2 percentage points higher in absolute terms
    const relativeIncrease = portfolioApy > 0 ? (opportunityApy / portfolioApy) : Infinity;
    const absoluteIncrease = opportunityApy - portfolioApy;

    const shouldTrigger = Number.isFinite(differenceBps)
      ? (relativeIncrease >= 1.1 && absoluteIncrease >= 2)
      : true;

    this.logger.log(
      `Precheck for user ${user.id}: portfolio APY=${portfolioApy.toFixed(2)}%, ` +
      `opportunity APY=${opportunityApy.toFixed(2)}%, diff=${differenceBps.toFixed(2)} bps, ` +
      `relative=${relativeIncrease.toFixed(2)}x, absolute=${absoluteIncrease.toFixed(2)}pp, ` +
      `total value=$${totalAssetsUsd.toFixed(2)} -> ${shouldTrigger ? 'trigger' : 'skip'}`,
    );

    return {
      shouldTrigger,
      portfolioApy,
      opportunityApy,
      differenceBps,
      totalPortfolioValueUsd: totalAssetsUsd,
      yieldSummary,
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
