import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import Anthropic from '@anthropic-ai/sdk';
import { AgentContext, AgentResult } from './agent.types';
import { SYSTEM_PROMPT, buildUserContext } from './agent.prompt';
import {
  buildLPRangeRecommendationPrompt,
  buildBestOpportunityPrompt,
  PortfolioAnalysisSummary,
  MarketOpportunitiesSummary,
  PoolRebalanceSuggestion,
} from './analysis.prompt';
import {
  AccountYieldSummaryResponse,
  ChainId,
  GetLpSimulateRequest,
  GetLpSimulateResponse,
  GetSupplyOpportunitiesResponse,
} from './types/mcp.types';
import { extractTxHashFromOutput, verifyTransactionOnChain } from '../utils/chain-verifier.util';
import {
  RebalancePlan,
  RebalanceOpportunity,
  RebalanceCostEstimate,
  RebalanceAnalysisData,
} from './agent.types';
import { lookupTokenAddress } from './token-utils';

interface ParsedStep1Summary extends PortfolioAnalysisSummary {
  totalAssetsUsd: number;
  portfolioApy: number;
  yieldSummary: AccountYieldSummaryResponse;
}

interface ParsedLpOpportunity {
  poolName: string;
  protocol: 'aerodromeSlipstream' | 'uniswapV3';
  poolAddress: string;
  token0Address: string;
  token0Symbol: string;
  token1Address: string;
  token1Symbol: string;
  tickStatus: '🎯 Ambush Ready' | '⚠️ Jump Soon' | 'Stable';
  targetTickLower: number;
  targetTickUpper: number;
  targetAmount0: number;
  targetAmount1: number;
  expectedAPY: number;
  currentAPY: number;
}

interface ParsedSupplyOpportunity {
  protocol: 'aave' | 'euler' | 'venus';
  tokenAddress: string;
  tokenSymbol: string;
  vToken: string;
  amount: number;
  expectedAPY: number;
  currentAPY: number;
}

interface ParsedStep2Summary extends MarketOpportunitiesSummary {
  bestLpOpportunity: ParsedLpOpportunity | null;
  lpCandidates: ParsedLpOpportunity[];
  bestSupplyOpportunity: ParsedSupplyOpportunity | null;
  supplyOpportunities: ParsedSupplyOpportunity[];
  lpPlanSuggestions: PoolRebalanceSuggestion[];
}

interface LpPoolContextEntry {
  poolAddress: string;
  poolName: string;
  protocol: 'aerodromeSlipstream' | 'uniswapV3';
  token0Address?: string;
  token0Symbol?: string;
  token1Address?: string;
  token1Symbol?: string;
  currentTick?: number;
  tickSpacing?: number;
  pricePositionPercent?: number | null;
  pricePositionText?: string | null;
  tvlUsd?: number | null;
  recentActiveTicks?: Array<{
    tick: number;
    tradingVolume: number;
    apy?: number;
  }>;
}

interface LpSimulationMeta {
  suggestion: PoolRebalanceSuggestion;
  scenario: {
    label: string;
    tickLower: number;
    tickUpper: number;
    notes?: string;
  };
  poolInfo: LpPoolContextEntry;
}

@Injectable()
export class AgentService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentService.name);
  private mcpClient: Client;
  private anthropicClient: Anthropic;
  private model: string;
  private allTools: any[] = [];
  private lastRequestTime: number = 0;
  private minRequestInterval: number = 5000; // Minimum 5 seconds between requests
  private readonly lpSimulationTimeHorizonMinutes = 30;

  constructor(private configService: ConfigService) {}

  /**
   * Throttle API requests to avoid rate limits
   */
  private async throttleRequest(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest;
      this.logger.log(`Throttling request: waiting ${waitTime}ms`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    this.lastRequestTime = Date.now();
  }

  async onModuleInit() {
    const apiKey = this.configService.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required but not set in environment variables');
    }

    // Initialize Anthropic client
    this.anthropicClient = new Anthropic({ apiKey });
    this.model = this.configService.get('MODEL') || 'claude-3-5-sonnet-20241022';
    this.logger.log(`Using Anthropic model: ${this.model}`);

    // Initialize MCP client
    const mcpServerCommand = this.configService.get('MCP_SERVER_COMMAND') || 'npx';
    const mcpServerArgs = this.configService.get('MCP_SERVER_ARGS') || '-y,@modelcontextprotocol/server-defi';
    const fullCommand = `${mcpServerCommand} ${mcpServerArgs.split(',').join(' ')}`;
    const [command, ...commandArgs] = fullCommand.split(' ');

    this.mcpClient = new Client(
      {
        name: 'owlia-agent-backend',
        version: '1.0.0',
      },
      {
        capabilities: {
          prompts: {},
          tools: {},
        },
      },
    );

    try {
      const transport = new StdioClientTransport({
        command,
        args: commandArgs,
      });
      await this.mcpClient.connect(transport);
      this.logger.log('MCP Client connected');

      // List available tools
      const toolsResponse = await this.mcpClient.listTools();
      this.allTools = toolsResponse.tools || [];
      this.logger.log(`Loaded ${this.allTools.length} tools from MCP server`);
      this.allTools.forEach(tool => {
        this.logger.log(`  - ${tool.name}`);
      });
    } catch (error) {
      this.logger.error(`Failed to connect to MCP Server: ${error.message}`);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (this.mcpClient) {
      await this.mcpClient.close();
      this.logger.log('MCP Client connection closed');
    }
  }

  private parseJsonOutput<T>(output: string, contextLabel: string): T {
    const match = output.match(/```json\s*([\s\S]*?)```/i);
    const jsonPayload = match ? match[1] : output;

    try {
      return JSON.parse(jsonPayload.trim()) as T;
    } catch (error) {
      this.logger.error(`Failed to parse JSON for ${contextLabel}: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`${contextLabel} response is not valid JSON`);
    }
  }

  /**
   * Map chain names to chain IDs
   */
  private getChainId(chainName: string): string {
    const chainMap: Record<string, string> = {
      'base': '8453',
      'ethereum': '1',
      'eth': '1',
      'mainnet': '1',
      'arbitrum': '42161',
      'optimism': '10',
      'polygon': '137',
      'bsc': '56',
      'avalanche': '43114',
    };
    return chainMap[chainName.toLowerCase()] || chainName;
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

  private buildLpPoolsContext(dexPools: Record<string, any>): LpPoolContextEntry[] {
    if (!dexPools || typeof dexPools !== 'object') {
      return [];
    }

    const entries: LpPoolContextEntry[] = [];

    for (const [poolAddress, rawData] of Object.entries(dexPools)) {
      if (poolAddress === '_dataSource') {
        continue;
      }

      const data: any = rawData || {};
      const currentSnapshot: any = data.currentSnapshot || {};
      const pricePosition: any = data.pricePosition || {};

      const token0Symbol = currentSnapshot.token0Symbol || currentSnapshot.token0 || '';
      const token1Symbol = currentSnapshot.token1Symbol || currentSnapshot.token1 || '';
      const poolName = token0Symbol && token1Symbol ? `${token0Symbol}/${token1Symbol}` : poolAddress;

      const protocol = (data.currentSnapshot.dexKey && String(data.currentSnapshot.dexKey).toLowerCase().includes('aerodrome'))
        ? 'aerodromeSlipstream'
        : 'uniswapV3';

      const positionPercent = this.parseNumber(pricePosition?.currentTickSpacingRange?.tickPositionInSpacing);
      const tvlUsd = this.parseNumber(currentSnapshot.tvl);

      const recentActiveTicks = Array.isArray(data.recentActiveTicks)
        ? data.recentActiveTicks.slice(0, 6).map((tick: any) => ({
            tick: Number(tick?.tick ?? 0),
            tradingVolume: this.parseNumber(tick?.tradingVolume) || 0,
            apy: this.parseNumber(tick?.apy) || 0,
          }))
        : [];

      entries.push({
        poolAddress,
        poolName,
        protocol,
        token0Address: currentSnapshot.token0Address || currentSnapshot.token0 || '',
        token0Symbol,
        token1Address: currentSnapshot.token1Address || currentSnapshot.token1 || '',
        token1Symbol,
        currentTick: Number(pricePosition?.currentTick ?? currentSnapshot.currentTick ?? 0),
        tickSpacing: Number(pricePosition?.tickSpacing ?? currentSnapshot.tickSpacing ?? 1),
        pricePositionText: pricePosition?.priceInfo?.pricePositionInRange || null,
        tvlUsd: tvlUsd ?? null,
        recentActiveTicks,
      });
    }

    return entries
      .sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))
      .slice(0, 15);
  }

  private buildBinanceTopBook(binanceDepth: any): Record<string, { bestBid: number | null; bestAsk: number | null }> {
    const summary: Record<string, { bestBid: number | null; bestAsk: number | null }> = {};

    if (!binanceDepth || typeof binanceDepth !== 'object') {
      return summary;
    }

    for (const [pair, raw] of Object.entries(binanceDepth)) {
      if (pair === '_dataSource') {
        continue;
      }

      const data: any = raw || {};
      const bids = Array.isArray(data.bids) ? data.bids : [];
      const asks = Array.isArray(data.asks) ? data.asks : [];

      summary[pair] = {
        bestBid: this.parseNumber(bids[0]?.price) ?? null,
        bestAsk: this.parseNumber(asks[0]?.price) ?? null,
      };
    }

    return summary;
  }

  private buildLpSimulationRequests(
    suggestions: PoolRebalanceSuggestion[],
    chainId: ChainId,
    amountUsd: number,
    poolContexts: LpPoolContextEntry[],
  ): { requests: GetLpSimulateRequest[]; meta: LpSimulationMeta[] } {
    const requests: GetLpSimulateRequest[] = [];
    const meta: LpSimulationMeta[] = [];
    const poolMap = new Map<string, LpPoolContextEntry>();
    poolContexts.forEach((entry) => {
      poolMap.set(entry.poolAddress.toLowerCase(), entry);
    });

    const notional = amountUsd;

    suggestions.forEach((suggestion) => {
      if (!suggestion.poolAddress) {
        this.logger.warn('LP plan suggestion missing poolAddress');
        return;
      }

      const poolInfo = poolMap.get(suggestion.poolAddress.toLowerCase());
      if (!poolInfo) {
        this.logger.warn(`LP plan suggestion references unknown pool ${suggestion.poolAddress}`);
        return;
      }

      const scenarios = Array.isArray(suggestion.scenarios) ? suggestion.scenarios : [];
      scenarios.forEach((scenario) => {
        if (
          typeof scenario.tickLower !== 'number' ||
          typeof scenario.tickUpper !== 'number' ||
          !Number.isFinite(scenario.tickLower) ||
          !Number.isFinite(scenario.tickUpper) ||
          scenario.tickLower >= scenario.tickUpper
        ) {
          this.logger.warn(`Skipping invalid LP scenario for pool ${suggestion.poolAddress}`);
          return;
        }

        const tickLower = Math.trunc(scenario.tickLower);
        const tickUpper = Math.trunc(scenario.tickUpper);

        const request: GetLpSimulateRequest = {
          chain_id: chainId,
          poolOperation: {
            poolAddress: suggestion.poolAddress,
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
        meta.push({
          suggestion,
          scenario: {
            label: scenario.label || `range_${tickLower}_${tickUpper}`,
            tickLower,
            tickUpper,
            notes: scenario.notes,
          },
          poolInfo,
        });
      });
    });

    return { requests, meta };
  }

  private buildLpCandidates(
    simulations: GetLpSimulateResponse[],
    meta: LpSimulationMeta[],
    poolContexts: LpPoolContextEntry[],
  ): ParsedLpOpportunity[] {
    if (!simulations || simulations.length === 0) {
      return [];
    }

    const candidates: ParsedLpOpportunity[] = [];

    simulations.forEach((simulation, index) => {
      const metaInfo = meta[index];
      if (!metaInfo) {
        return;
      }

      const { suggestion, scenario, poolInfo } = metaInfo;

      const requiredTokens: any = simulation.summary?.requiredTokens || {};
      const token0Amount = this.parseNumber(requiredTokens?.token0?.amount) || 0;
      const token1Amount = this.parseNumber(requiredTokens?.token1?.amount) || 0;
      const expectedAPY = this.parseNumber(simulation.pool?.after?.estimatedAPY) || 0;
      const currentAPY = this.parseNumber(simulation.pool?.before?.apy) || 0;

      const protocol = suggestion.protocol || poolInfo.protocol || 'uniswapV3';
      const poolName = suggestion.poolName || poolInfo.poolName || suggestion.poolAddress;

      candidates.push({
        poolName,
        protocol: protocol as 'aerodromeSlipstream' | 'uniswapV3',
        poolAddress: suggestion.poolAddress,
        token0Address: suggestion.token0Address || poolInfo.token0Address || '',
        token0Symbol: suggestion.token0Symbol || poolInfo.token0Symbol || '',
        token1Address: suggestion.token1Address || poolInfo.token1Address || '',
        token1Symbol: suggestion.token1Symbol || poolInfo.token1Symbol || '',
        tickStatus: suggestion.tickStatus,
        targetTickLower: scenario.tickLower,
        targetTickUpper: scenario.tickUpper,
        targetAmount0: token0Amount,
        targetAmount1: token1Amount,
        expectedAPY,
        currentAPY,
      });
    });

    return candidates;
  }

  private buildSupplyOpportunities(
    supplyOpps: GetSupplyOpportunitiesResponse | null | undefined,
    notionalAmount: number,
    chainId: string,
  ): ParsedSupplyOpportunity[] {
    const opportunities: any[] = Array.isArray(supplyOpps?.opportunities)
      ? supplyOpps!.opportunities as any[]
      : [];

    return opportunities.map((opp) => {
      const protocol = this.normalizeProtocolName(opp.protocol || '');
      let tokenAddress = opp.assetAddress || opp.asset_address || opp.tokenAddress || '';
      const tokenSymbol = opp.asset || opp.tokenSymbol || '';

      if ((!tokenAddress || tokenAddress === '') && ['aave', 'venus'].includes(protocol) && tokenSymbol) {
        tokenAddress = lookupTokenAddress(tokenSymbol, chainId);
        if (tokenAddress) {
          this.logger.log(`Filled missing token address for ${protocol} ${tokenSymbol}: ${tokenAddress}`);
        } else {
          this.logger.warn(`Could not resolve token address for ${protocol} ${tokenSymbol}`);
        }
      }

      if (!tokenAddress) {
        this.logger.warn(`Supply opportunity missing token address for asset ${tokenSymbol || 'unknown'}`);
        return null;
      }

      return {
        protocol,
        tokenAddress,
        tokenSymbol,
        vToken: opp.vault_address || opp.vToken || '',
        amount: notionalAmount,
        expectedAPY: this.parseNumber(opp.after?.supplyAPY) || 0,
        currentAPY: this.parseNumber(opp.before?.supplyAPY) || 0,
      } as ParsedSupplyOpportunity;
    }).filter((item): item is ParsedSupplyOpportunity => item !== null);
  }

  private selectBestLpOpportunity(candidates: ParsedLpOpportunity[]): ParsedLpOpportunity | null {
    if (!candidates || candidates.length === 0) {
      return null;
    }
    return candidates.reduce((best, current) => (current.expectedAPY > best.expectedAPY ? current : best), candidates[0]);
  }

  private selectBestSupplyOpportunity(candidates: ParsedSupplyOpportunity[]): ParsedSupplyOpportunity | null {
    if (!candidates || candidates.length === 0) {
      return null;
    }
    return candidates.reduce((best, current) => (current.expectedAPY > best.expectedAPY ? current : best), candidates[0]);
  }

  private extractCostEstimatesFromStructuredData(structuredData: any): RebalanceCostEstimate[] {
    if (!structuredData) {
      return [];
    }

    if (Array.isArray(structuredData.costEstimates)) {
      return structuredData.costEstimates as RebalanceCostEstimate[];
    }

    if (structuredData.analysis && typeof structuredData.analysis === 'object') {
      const analysis = structuredData.analysis;
      const gasEstimate = this.parseNumber(analysis.gasEstimate);
      const estimate: RebalanceCostEstimate = {
        name: analysis.strategy || 'selected strategy',
        gasEstimate: gasEstimate ?? undefined,
        netGasUsd: this.parseNumber(analysis.netGasUsd) ?? undefined,
        breakEvenTime: typeof analysis.breakEvenTime === 'string' ? analysis.breakEvenTime : undefined,
        reason: typeof analysis.reason === 'string' ? analysis.reason : undefined,
      };
      return [estimate];
    }

    return [];
  }

  private normalizePlan(
    rawPlan: any,
    defaults: { chainId: string; userAddress: string },
    costEstimates: RebalanceCostEstimate[],
  ): RebalancePlan {
    const opportunities: RebalanceOpportunity[] = Array.isArray(rawPlan?.opportunities)
      ? rawPlan.opportunities as RebalanceOpportunity[]
      : [];
    const currentPositions: any[] = Array.isArray(rawPlan?.currentPositions)
      ? rawPlan.currentPositions
      : [];

    const normalized: RebalancePlan = {
      description: rawPlan?.description,
      recommendation: rawPlan?.recommendation,
      hasOpportunity: rawPlan?.hasOpportunity ?? opportunities.length > 0,
      shouldRebalance: rawPlan?.shouldRebalance,
      opportunities,
      currentPositions,
      chainId: rawPlan?.chainId || defaults.chainId,
      userAddress: rawPlan?.userAddress || defaults.userAddress,
      costEstimates: costEstimates.length
        ? costEstimates
        : Array.isArray(rawPlan?.costEstimates)
          ? rawPlan.costEstimates
          : undefined,
    };

    return normalized;
  }


  private extractTargetPositionsFromPlan(opportunities: RebalanceOpportunity[]): {
    supply: Array<{ protocol: string; token: string; vToken: string; amount: string }>;
    liquidity: Array<{
      protocol: 'uniswapV3' | 'aerodromeSlipstream';
      poolAddress: string;
      token0Address: string;
      token1Address: string;
      targetTickLower: number;
      targetTickUpper: number;
      targetAmount0: string;
      targetAmount1: string;
    }>;
  } {
    const supply: Array<{ protocol: string; token: string; vToken: string; amount: string }> = [];
    const liquidity: Array<{
      protocol: 'uniswapV3' | 'aerodromeSlipstream';
      poolAddress: string;
      token0Address: string;
      token1Address: string;
      targetTickLower: number;
      targetTickUpper: number;
      targetAmount0: string;
      targetAmount1: string;
    }> = [];

    for (const opp of opportunities) {
      if (!opp) {
        continue;
      }

      const rawProtocol = typeof opp.protocol === 'string' ? opp.protocol : '';
      const protocol = this.normalizeProtocolName(rawProtocol.trim());

      if (['aave', 'euler', 'venus'].includes(protocol)) {
        const tokenAddress = typeof opp.tokenAddress === 'string' ? opp.tokenAddress : '';
        const vToken = typeof opp.vToken === 'string' ? opp.vToken : '';
        const amountStr = this.toDecimalString(opp.amount);

        // if (!tokenAddress || !vToken || !amountStr) {
        //   this.logger.warn(`Skipping incomplete supply opportunity for protocol ${protocol}`);
        //   continue;
        // }

        supply.push({
          protocol,
          token: tokenAddress,
          vToken,
          amount: amountStr,
        });
        continue;
      }

      if (['uniswapV3', 'aerodromeSlipstream', 'aerodrome'].includes(protocol)) {
        const normalizedProtocol = protocol === 'aerodrome' ? 'aerodromeSlipstream' : (protocol as 'uniswapV3' | 'aerodromeSlipstream');
        const poolAddress = typeof opp.poolAddress === 'string' ? opp.poolAddress : '';
        const token0Address = typeof opp.token0Address === 'string' ? opp.token0Address : '';
        const token1Address = typeof opp.token1Address === 'string' ? opp.token1Address : '';

        const tickLowerNum = this.parseNumber(opp.targetTickLower);
        const tickUpperNum = this.parseNumber(opp.targetTickUpper);
        const amount0Str = this.toDecimalString(opp.targetAmount0);
        const amount1Str = this.toDecimalString(opp.targetAmount1);

        if (
          !poolAddress ||
          !token0Address ||
          !token1Address ||
          tickLowerNum === null ||
          tickUpperNum === null ||
          tickLowerNum >= tickUpperNum ||
          !amount0Str ||
          !amount1Str
        ) {
          this.logger.warn(`Skipping incomplete LP opportunity for protocol ${protocol} at pool ${poolAddress}`);
          continue;
        }

        liquidity.push({
          protocol: normalizedProtocol,
          poolAddress,
          token0Address,
          token1Address,
          targetTickLower: Math.trunc(tickLowerNum),
          targetTickUpper: Math.trunc(tickUpperNum),
          targetAmount0: amount0Str,
          targetAmount1: amount1Str,
        });
      }
    }

    return { supply, liquidity };
  }

  private toDecimalString(value: any): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return null;
      }
      return value.toString();
    }

    return null;
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

  /**
   * Normalize protocol names to match execution tool requirements
   */
  private normalizeProtocolName(protocol: string): string {
    const protocolMap: Record<string, string> = {
      'aerodromecl': 'aerodromeSlipstream',
      'aerodrome': 'aerodromeSlipstream',
      'uniswapv3': 'uniswapV3',
      'aave': 'aave',
      'euler': 'euler',
      'venus': 'venus',
    };
    return protocolMap[protocol.toLowerCase()] || protocol;
  }

  /**
   * Filter tools based on context to reduce token usage
   */
  private filterToolsForContext(trigger: string): any[] {
    // Essential tools for position fetching
    if (trigger === 'fetch_positions') {
      const allowedTools = [
        'get_idle_assets',
        'get_active_investments',
      ];
      return this.allTools.filter(tool => allowedTools.includes(tool.name));
    }

    // Essential tools for rebalancing
    if (trigger === 'trigger_rebalance' || trigger === 'manual_trigger' || trigger === 'manual_preview' || trigger === 'scheduled_monitor') {
      const allowedTools = [
        // Position data
        'get_idle_assets',
        'get_active_investments',
        'get_account_yield_summary',
        // Market data
        'get_dex_pools',
        'get_binance_depth',
        // Simulation
        'get_lp_simulate_batch',
        'get_supply_opportunities',
        // Analysis
        'analyze_strategy',
        'calculate_rebalance_cost_batch',
      ];
      return this.allTools.filter(tool => allowedTools.includes(tool.name));
    }

    // For execution, only include execution tools
    if (trigger === 'execute_rebalance') {
      const allowedTools = [
        'rebalance_position',
      ];
      return this.allTools.filter(tool => allowedTools.includes(tool.name));
    }

    // Default: return all tools (fallback)
    return this.allTools;
  }

  /**
   * Directly execute an MCP tool and return parsed output.
   * Useful for lightweight data fetches outside of full agent runs.
   */
  async callMcpTool<T = any>(toolName: string, input: Record<string, any>): Promise<T> {
    if (!this.mcpClient) {
      throw new Error('MCP client not initialized');
    }

    const toolExists = this.allTools.some(tool => tool.name === toolName);
    if (!toolExists) {
      throw new Error(`Tool ${toolName} is not available on MCP server`);
    }

    // await this.throttleRequest();
    this.logger.log(`Calling MCP tool ${toolName} with input ${JSON.stringify(input)}`);

    const result = await this.mcpClient.callTool({
      name: toolName,
      arguments: input,
    });

    const resultText = result.content?.[0]?.text;
    if (!resultText) {
      this.logger.warn(`Tool ${toolName} returned empty content`);
      return result as unknown as T;
    }

    try {
      const parsed = JSON.parse(resultText);
      this.logger.log(`Tool ${toolName} returned keys: ${Object.keys(parsed).join(', ')}`);
      return parsed as T;
    } catch {
      this.logger.warn(`Tool ${toolName} returned non-JSON content: ${resultText}`);
      return resultText as unknown as T;
    }
  }

  /**
   * Wrapper with automatic retry and checkpoint resume for entire agent run
   */
  private async runAnthropicAgentWithRetry(
    userMessage: string,
    forceToolUse: boolean = false,
    trigger: string = ''
  ): Promise<any> {
    const maxGlobalRetries = 2;
    let globalRetry = 0;
    let lastCheckpoint: { messages: any[], toolResults: any[], currentTurn: number } | undefined;

    while (globalRetry <= maxGlobalRetries) {
      try {
        return await this.runAnthropicAgent(userMessage, forceToolUse, trigger, lastCheckpoint);
      } catch (error) {
        if (error.status === 429 && globalRetry < maxGlobalRetries) {
          globalRetry++;
          const delay = 60000 * globalRetry; // 60s, 120s
          this.logger.error(`Agent run failed with rate limit (global retry ${globalRetry}/${maxGlobalRetries})`);
          this.logger.log(`Waiting ${delay/1000}s before retrying entire run...`);

          // Try to extract checkpoint from error context if available
          // (In practice, the checkpoint is maintained within runAnthropicAgent)

          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }

    throw new Error('Failed to complete agent run after max global retries');
  }

  /**
   * Run agent with Anthropic SDK (with checkpoint resume capability)
   */
  private async runAnthropicAgent(
    userMessage: string,
    forceToolUse: boolean = false,
    trigger: string = '',
    resumeState?: { messages: any[], toolResults: any[], currentTurn: number }
  ): Promise<any> {
    // Filter tools based on context to reduce token usage
    const filteredTools = trigger ? this.filterToolsForContext(trigger) : this.allTools;
    this.logger.log(`Using ${filteredTools.length} tools (filtered from ${this.allTools.length})`);

    const tools = filteredTools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.inputSchema || { type: 'object', properties: {}, required: [] },
    }));

    // Resume from checkpoint or start fresh
    let messages: any[];
    let toolResults: any[];
    let currentTurn: number;

    if (resumeState) {
      this.logger.log(`Resuming from checkpoint: turn ${resumeState.currentTurn}, ${resumeState.toolResults.length} tool results`);
      messages = resumeState.messages;
      toolResults = resumeState.toolResults;
      currentTurn = resumeState.currentTurn;
    } else {
      messages = [{ role: 'user', content: userMessage }];
      toolResults = [];
      currentTurn = 0;
    }

    const maxTurns = 10;

    while (currentTurn < maxTurns) {
      currentTurn++;
      this.logger.log(`Agent turn ${currentTurn}/${maxTurns}`);

      const requestParams: any = {
        model: this.model,
        max_tokens: 4096,
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' }, // Cache system prompt
          }
        ],
        messages,
        tools,
      };

      // Force tool use on first turn if requested
      if (currentTurn === 1 && forceToolUse) {
        requestParams.tool_choice = { type: 'any' };
      }

      let response;
      let retries = 0;
      const maxRetries = 3;
      const baseDelay = 30000; // 30 seconds base delay

      while (retries <= maxRetries) {
        try {
          // Throttle requests to avoid rate limits
          await this.throttleRequest();

          response = await this.anthropicClient.messages.create(requestParams);
          break; // Success, exit retry loop
        } catch (error) {
          // Handle rate limit errors with exponential backoff
          if (error.status === 429 && retries < maxRetries) {
            retries++;
            const delay = baseDelay * Math.pow(2, retries - 1); // Exponential backoff: 30s, 60s, 120s
            this.logger.warn(`Rate limit hit (attempt ${retries}/${maxRetries}), waiting ${delay/1000} seconds before retry...`);
            this.logger.log(`Checkpoint saved: turn ${currentTurn}, ${messages.length} messages, ${toolResults.length} tool results`);
            await new Promise(resolve => setTimeout(resolve, delay));
            // Continue with same state - no need to restart
          } else {
            this.logger.error(`Request failed with error: ${error.status} ${error.message}`);
            throw error;
          }
        }
      }

      if (!response) {
        throw new Error('Failed to get response after max retries');
      }

      // Check stop reason
      this.logger.log(`Turn ${currentTurn} stop reason: ${response.stop_reason}`);
      this.logger.log(`Turn ${currentTurn} content types: ${response.content.map(c => c.type).join(', ')}`);

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        // Extract final text response
        const textContent = response.content.find(c => c.type === 'text');
        const finalText = textContent ? (textContent as any).text : '';

        this.logger.log(`Agent finished with stop_reason: ${response.stop_reason}`);
        this.logger.log(`Total tool calls made: ${toolResults.length}`);
        this.logger.log(`Final response preview: ${finalText}...`);

        return {
          finalOutput: finalText,
          toolResults,
        };
      }

      if (response.stop_reason === 'tool_use') {
        // Process tool calls
        const toolUses = response.content.filter(c => c.type === 'tool_use');

        // Add assistant message to history
        messages.push({ role: 'assistant', content: response.content });

        // Execute each tool
        const toolResultsContent: any[] = [];
        for (const toolUse of toolUses) {
          const toolData = toolUse as any;
          this.logger.log(`Calling tool: ${toolData.name} with args: ${JSON.stringify(toolData.input)}`);

          try {
            const result = await this.mcpClient.callTool({
              name: toolData.name,
              arguments: toolData.input,
            });

            // Parse result
            const resultText = result.content?.[0]?.text || JSON.stringify(result);
            let parsedResult: any;
            try {
              parsedResult = JSON.parse(resultText);
            } catch {
              parsedResult = resultText;
            }

            toolResults.push({
              tool: toolData.name,
              input: toolData.input,
              output: parsedResult,
            });

            toolResultsContent.push({
              type: 'tool_result',
              tool_use_id: toolData.id,
              content: resultText,
            });

            // Log detailed output
            this.logger.log(`Tool ${toolData.name} completed`);
            this.logger.log(`Tool ${toolData.name} output preview: ${JSON.stringify(parsedResult)}`);

            // Special logging for specific tools
            if (toolData.name === 'get_supply_opportunities') {
              const opportunities = parsedResult?.opportunities || parsedResult;
              this.logger.log(`get_supply_opportunities returned ${Array.isArray(opportunities) ? opportunities.length : 0} opportunities`);
              if (Array.isArray(opportunities) && opportunities.length > 0) {
                this.logger.log(`Top 3 opportunities: ${JSON.stringify(opportunities.slice(0, 3), null, 2)}`);
              } else {
                this.logger.warn(`get_supply_opportunities returned no opportunities. Full output: ${JSON.stringify(parsedResult)}`);
              }
            }
          } catch (error) {
            this.logger.error(`Tool ${toolData.name} failed: ${error.message}`);
            toolResultsContent.push({
              type: 'tool_result',
              tool_use_id: toolData.id,
              content: `Error: ${error.message}`,
              is_error: true,
            });
          }
        }

        // Add tool results to messages
        messages.push({ role: 'user', content: toolResultsContent });
      } else {
        // Unexpected stop reason
        this.logger.warn(`Unexpected stop reason: ${response.stop_reason}`);
        const textContent = response.content.find(c => c.type === 'text');
        return {
          finalOutput: textContent ? (textContent as any).text : '',
          toolResults,
        };
      }
    }

    return {
      finalOutput: 'Max turns reached',
      toolResults,
    };
  }

  async runRebalanceAgent(context: AgentContext): Promise<AgentResult> {
    try {
      this.logger.log(`Starting agent run for job ${context.jobId}`);

      if(!['manual_trigger', 'manual_preview', 'scheduled_monitor', 'fetch_positions'].includes(context.trigger)) {
        this.logger.error(`unsupported trigger: ${context.trigger}`)
        return
      }

      // For manual_trigger-like flows, execute three smaller prompts sequentially
      if (context.trigger === 'manual_trigger' || context.trigger === 'manual_preview' || context.trigger === 'scheduled_monitor') {
        const chainId = context.userPolicy.chains[0] || 'base';
        const chainIdNum = this.getChainId(chainId);
        const chainIdEnum = chainIdNum as ChainId;

        this.logger.log('Running multi-step analysis prompts');
        this.logger.log(`Using chain_id: ${chainIdNum} (from chain: ${chainId})`);
        this.logger.log(`User address: ${context.userAddress}`);

        const combinedToolResults: any[] = [];

        // Step 1: Account summary
        const step1Input = {
          wallet_address: context.userAddress,
          chain_id: chainIdEnum,
        };
        this.logger.log(`Fetching account yield summary via MCP: ${JSON.stringify(step1Input)}`);
        const yieldSummary = await this.callMcpTool<AccountYieldSummaryResponse>('get_account_yield_summary', step1Input);
        combinedToolResults.push({
          tool: 'get_account_yield_summary',
          input: step1Input,
          output: yieldSummary,
        });

        const totalAssetsUsd = this.parseNumber(yieldSummary?.totalAssetsUsd) || 0;
        const portfolioApy = this.parseNumber(yieldSummary?.portfolioApy) || 0;

        const step1Summary: ParsedStep1Summary = {
          totalAssetsUsd,
          portfolioApy,
          yieldSummary,
        };

        this.logger.log(`step1Summary: ${JSON.stringify(step1Summary)}`)

        // Step 2: Opportunity analysis (hybrid approach)
        const dexPoolsInput = { chain_id: chainIdEnum };
        const dexPools = await this.callMcpTool<Record<string, any>>('get_dex_pools', dexPoolsInput);
        combinedToolResults.push({ tool: 'get_dex_pools', input: dexPoolsInput, output: dexPools });

        this.logger.log(`dexPools: ${JSON.stringify(dexPools)}`);

        const binanceDepthInput = {tokens: ['USDC', 'USDT']};
        const binanceDepth = await this.callMcpTool<any>('get_binance_depth', binanceDepthInput);
        combinedToolResults.push({ tool: 'get_binance_depth', input: binanceDepthInput, output: binanceDepth });

        const lpPoolsContext = this.buildLpPoolsContext(dexPools);
        const binanceTopBook = this.buildBinanceTopBook(binanceDepth);

        const lpContext = {
          deployableCapital: totalAssetsUsd,
          pools: lpPoolsContext,
          binanceDepth: binanceTopBook,
        };

        this.logger.log(`step2 lpContext: ${JSON.stringify(lpContext, null, 2)}`)

        const step2Prompt = buildLPRangeRecommendationPrompt({
          address: context.userAddress,
          chainId: chainIdNum,
          portfolioSummary: step1Summary,
          liquidityPoolContext: lpContext,
        });
        this.logger.log(`Step 2 prompt length: ${step2Prompt.length} characters`);
        const step2Result = await this.runAnthropicAgentWithRetry(step2Prompt, false, context.trigger);
        combinedToolResults.push(...(step2Result.toolResults || []));

        const lpPlanResponse = this.parseJsonOutput<{ lpPlanSuggestions: PoolRebalanceSuggestion[] }>(
          step2Result.finalOutput,
          'Step 2 LP plan',
        );
        const lpPlanSuggestions = Array.isArray(lpPlanResponse.lpPlanSuggestions)
          ? lpPlanResponse.lpPlanSuggestions
          : [];

        const lpSimulationRequestsData = this.buildLpSimulationRequests(
          lpPlanSuggestions,
          chainIdEnum,
          totalAssetsUsd,
          lpPoolsContext,
        );

        let lpSimulationResults: GetLpSimulateResponse[] = [];
        if (lpSimulationRequestsData.requests.length > 0) {
          const lpSimInput = { reqs: lpSimulationRequestsData.requests };
          const lpSimRaw = await this.callMcpTool<any>('get_lp_simulate_batch', lpSimInput);
          lpSimulationResults = this.normalizeDictionaryResponse<GetLpSimulateResponse>(lpSimRaw);
          combinedToolResults.push({ tool: 'get_lp_simulate_batch', input: lpSimInput, output: lpSimulationResults });
        } else {
          this.logger.warn('No LP simulation requests generated from agent suggestions');
        }

        const lpCandidates = this.buildLpCandidates(
          lpSimulationResults,
          lpSimulationRequestsData.meta,
          lpPoolsContext,
        );
        const bestLpOpportunity = this.selectBestLpOpportunity(lpCandidates);

        const supplyInput = {
          chain_id: chainIdEnum,
          amount: totalAssetsUsd,
        };
        const supplyOpps = await this.callMcpTool<GetSupplyOpportunitiesResponse>('get_supply_opportunities', supplyInput);
        combinedToolResults.push({ tool: 'get_supply_opportunities', input: supplyInput, output: supplyOpps });

        this.logger.log(`supplyOpps: ${JSON.stringify(supplyOpps)}`)
        const supplyCandidates = this.buildSupplyOpportunities(supplyOpps, totalAssetsUsd, chainIdEnum);
        const bestSupplyOpportunity = this.selectBestSupplyOpportunity(supplyCandidates);

        this.logger.log(`supplyCandidates: ${JSON.stringify(supplyCandidates)}`)
        this.logger.log(`bestSupplyOpportunity: ${JSON.stringify(bestSupplyOpportunity)}`)


        const step2Summary: ParsedStep2Summary = {
          lpPlanSuggestions,
          bestLpOpportunity: bestLpOpportunity || null,
          lpCandidates,
          bestSupplyOpportunity: bestSupplyOpportunity || null,
          supplyOpportunities: supplyCandidates,
        };

        // Step 3: Strategy evaluation
        const step3Prompt = buildBestOpportunityPrompt({
          address: context.userAddress,
          chainId: chainIdNum,
          portfolioSummary: step1Summary,
          marketOpportunitiesSummary: step2Summary,
        });
        this.logger.log(`Step 3 prompt length: ${step3Prompt.length} characters`);
        const step3Result = await this.runAnthropicAgentWithRetry(step3Prompt, false, context.trigger);
        combinedToolResults.push(...(step3Result.toolResults || []));

        this.logger.log(`step3Result: ${JSON.stringify(step3Result)}`)

        this.logger.log(`Agent run completed across three prompts`);

        const finalOutput = step3Result.finalOutput;
        const finalToolResults = combinedToolResults;
        let costEstimates: RebalanceCostEstimate[] = [];

        // Extract simulation and plan from tool results or final output
        let simulation: any = null;
        let plan: RebalancePlan | null = null;

        if (finalToolResults.length > 0) {
          const analysisResult = finalToolResults.find(
            r => r.tool === 'analyze_strategy' || r.tool === 'calculate_rebalance_cost_batch'
          );
          if (analysisResult && analysisResult.output) {
            simulation = analysisResult.output.simulation || analysisResult.output;
          }
        }

        // Parse structured output from agent
        let structuredData: any = null;
        try {
          structuredData = this.parseJsonOutput<any>(finalOutput, 'Step 3 final output');
          costEstimates = this.extractCostEstimatesFromStructuredData(structuredData);
          this.logger.log('Successfully parsed structured JSON output from Step 3');
          this.logger.log(`Structured data keys: ${Object.keys(structuredData).join(', ')}`);

          // Handle "no rebalance" recommendation
          if (structuredData.shouldRebalance === false) {
            this.logger.log('Agent recommends NOT rebalancing');
            return {
              success: true,
              action: 'analyzed',
              data: {
                simulation: null,
                plan: null,
                summary: structuredData.summary,
                reasoning: structuredData.recommendation || finalOutput,
                analysis: structuredData.analysis || {},
                shouldRebalance: false,
                toolResults: finalToolResults,
                step1Summary,
                step2Summary,
              },
            };
          }

          // Build rebalance plan from structured output
          if (structuredData.opportunities?.length > 0) {
            this.logger.log(`Found ${structuredData.opportunities.length} opportunities in structured output`);

            const normalizedOpportunities = structuredData.opportunities.map(opp => ({
              ...opp,
              protocol: opp.protocol ? this.normalizeProtocolName(opp.protocol) : opp.protocol,
            }));

            plan = this.normalizePlan(
              {
                description: 'Rebalance plan from structured analysis',
                summary: structuredData.summary,
                recommendation: structuredData.recommendation || finalOutput,
                hasOpportunity: true,
                shouldRebalance: true,
                opportunities: normalizedOpportunities,
                currentPositions: structuredData.currentPositions || [],
                chainId: structuredData.chainId || chainIdNum,
                userAddress: structuredData.userAddress || context.userAddress,
              },
              { chainId: chainIdNum, userAddress: context.userAddress },
              costEstimates,
            );
          }
        } catch (parseError) {
          this.logger.warn(`Could not parse structured JSON from Step 3 output: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
        }

        // Return final result
        this.logger.log(`Final result - has plan: ${!!plan}`);

        const data: RebalanceAnalysisData = {
          simulation: simulation ?? null,
          plan: plan ?? null,
          summary: structuredData?.summary,
          reasoning: structuredData?.recommendation || finalOutput,
          toolResults: finalToolResults,
          step1Summary,
          step2Summary,
        };

        return {
          success: true,
          action: plan ? 'simulated' : 'analyzed',
          data,
        };
      }
    } catch (error) {
      this.logger.error(`Agent run failed: ${error.status || 'unknown'} ${error.message}`);

      return {
        success: false,
        action: 'rejected',
        error: error.message,
      };
    }
  }

  async executeRebalance(
    userId: string,
    plan: RebalancePlan,
    idempotencyKey: string,
    userAddress?: string,
  ): Promise<any> {
    try {
      this.logger.log(`Executing rebalance for user ${userId}`);

      const safeAddress = userAddress || plan?.safeAddress || plan?.userAddress || plan?.address;
      const chainId = plan?.chainId || '8453';

      if (!safeAddress) {
        throw new Error('safeAddress is required but not found in plan or parameters');
      }

      const opportunities = Array.isArray(plan?.opportunities) ? plan.opportunities : [];
      if (!opportunities.length) {
        throw new Error('Plan is missing opportunities; cannot execute rebalance');
      }

      const { supply, liquidity } = this.extractTargetPositionsFromPlan(opportunities);

      if (supply.length === 0 && liquidity.length === 0) {
        throw new Error('No executable positions found in plan opportunities');
      }

      const payload = {
        safeAddress,
        walletAddress: safeAddress,
        chainId: chainId.toString(),
        idempotencyKey,
        targetLendingSupplyPositions: supply,
        targetLiquidityPositions: liquidity,
      };

      this.logger.log(
        `Calling rebalance_position with ${supply.length} supply positions and ${liquidity.length} liquidity positions`,
      );

      const rebalanceResult = await this.callMcpTool<any>('rebalance_position', payload);

      const txHash =
        rebalanceResult?.txHash ||
        rebalanceResult?.transactionHash ||
        extractTxHashFromOutput(JSON.stringify(rebalanceResult));

      if (txHash) {
        this.logger.log(`Verifying transaction ${txHash} on chain ${chainId}`);
        const verification = await verifyTransactionOnChain(txHash, chainId);

        if (verification.success && verification.confirmed) {
          return {
            success: true,
            txHash,
            transactionHash: txHash,
            blockNumber: verification.blockNumber,
            status: 'confirmed',
            result: rebalanceResult,
          };
        }

        if (verification.success && !verification.confirmed) {
          return {
            success: false,
            txHash,
            transactionHash: txHash,
            status: verification.status || 'failed',
            reason: verification.error || 'Transaction not confirmed',
            result: rebalanceResult,
          };
        }
      }

      const success = rebalanceResult?.success !== false;
      if (!success) {
        throw new Error(rebalanceResult?.error || 'Rebalance execution failed');
      }

      return {
        success,
        result: rebalanceResult,
      };
    } catch (error) {
      this.logger.error(`Execute rebalance failed: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
