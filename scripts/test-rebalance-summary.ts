#!/usr/bin/env ts-node

/**
 * Test script for rebalance summary generation
 * Uses the getRebalanceSummaryPrompt to analyze rebalancing logs and generate user-friendly summaries
 *
 * Usage: npx ts-node scripts/test-rebalance-summary.ts [log-file-path]
 *
 * Example:
 *   npx ts-node scripts/test-rebalance-summary.ts
 *   npx ts-node scripts/test-rebalance-summary.ts ./logs/rebalance-2024-01-01.log
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';
import { AgentService } from '../src/agent/agent.service';
import { getRebalanceSummaryPrompt } from '../src/agent/agent.prompt';

// Load environment variables
dotenv.config();

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('Error: ANTHROPIC_API_KEY not found in environment variables');
  process.exit(1);
}

// Mock ConfigService that reads from process.env
class MockConfigService extends ConfigService {
  get(key: string, defaultValue?: any): any {
    return process.env[key] || defaultValue;
  }
}

// Sample rebalancing log data (can be replaced with actual log file)
const SAMPLE_REBALANCE_LOG = `
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:32 PM     LOG [MonitorService] Checking positions for user e5051acd-95eb-4494-a1fc-c0b9f9e6c441
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:32 PM     LOG [AgentService] Calling MCP tool get_account_yield_summary with input {"wallet_address":"0xcd16c350a8df6ab7eabbe9c28a440684bc664f93","chain_id":"8453"}
0|owlia-ai-agent  | [API] Calling real API for get_account_yield_summary
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_account_yield_summary returned keys: idleAssets, activeInvestments, totalAssetsUsd, portfolioApy, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [RebalancePrecheckService] Portfolio for user e5051acd-95eb-4494-a1fc-c0b9f9e6c441: totalAssets=$989.9438, APY=7.8189%, holdings={"USDC":695.8276,"USDT":294.39889999999997}
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool get_dex_pools with input {"chain_id":"8453"}
0|owlia-ai-agent  | [API] Calling real API for get_dex_pools
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_dex_pools returned keys: 0xa41bc0affba7fd420d186b84899d7ab2ac57fcd1, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [RebalancePrecheckService] get_dex_pools response: {"0xa41bc0affba7fd420d186b84899d7ab2ac57fcd1":{"currentSnapshot":{"dexKey":"AerodromeSlipstream","timestampMs":"1761811473","poolAddress":"0xa41bc0affba7fd420d186b84899d7ab2ac57fcd1","token0":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","token1":"0xfde4c96c8593536e31f229ea8f37b2ada2699bb2","token0Symbol":"USDC","token1Symbol":"USDT","fee":"70","currentTick":"9","tickSpacing":"1","currentPrice":"79264999177280242450128833709","startTick":"9","tvl":"1776443.8930360454655"},"pricePosition":{"currentTick":9,"tickSpacing":1,"currentTickSpacingRange":{"lowerBound":9,"upperBound":10,"tickPositionInSpacing":"0.00%","description":"At lower bound"},"priceInfo":{"currentPrice":"1.000930104279598249","currentPriceNumber":1.0009301042795982,"lowerBoundPrice":"1.000900360084012508","upperBoundPrice":"1.001000450120020924","priceRange":"0.000100090036008416","pricePositionInRange":"29.72%"},"feeContext":{"tickSpacingInBps":1,"approximateFeePercentage":"0.01%"},"activeTicksContext":{"5min":{"totalActiveTicks":1,"totalVolume":"502.24","range":{"min":9,"max":9,"span":0},"nearestActiveTicks":{"lower":9,"upper":10},"ticksWithVolume":[{"tick":9,"volume":"502.24"}]},"15min":{"totalActiveTicks":1,"totalVolume":"4421.32","range":{"min":9,"max":9,"span":0},"nearestActiveTicks":{"lower":9,"upper":10},"ticksWithVolume":[{"tick":9,"volume":"4421.32"}]},"30min":{"totalActiveTicks":1,"totalVolume":"67667.77","range":{"min":9,"max":9,"span":0},"nearestActiveTicks":{"lower":9,"upper":10},"ticksWithVolume":[{"tick":9,"volume":"67667.77"}]},"1hr":{"totalActiveTicks":1,"totalVolume":"111958.23","range":{"min":9,"max":9,"span":0},"nearestActiveTicks":{"lower":9,"upper":10},"ticksWithVolume":[{"tick":9,"volume":"111958.23"}]},"6hr":{"totalActiveTicks":1,"totalVolume":"111958.23","range":{"min":9,"max":9,"span":0},"nearestActiveTicks":{"lower":9,"upper":10},"ticksWithVolume":[{"tick":9,"volume":"111958.23"}]}}},"recentActiveTicks":[{"tick":"9","tradingVolume":"2647.54","apy":"0.0059479431986831858273","token0AmountUsd":"744313.284485","token1AmountUsd":"315321.21867193011279"}],"totalTVL":"1776443.8930360454655","fee":"70","tickSpacing":"1"},"_dataSource":"api"}
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool get_lp_simulate_batch with input {"reqs":[{"chain_id":"8453","poolOperation":{"poolAddress":"0xa41bc0affba7fd420d186b84899d7ab2ac57fcd1","operation":"add","amountUSD":989.9438,"tickLower":9,"tickUpper":10,"timeHorizon":30},"priceImpact":false,"includeIL":true}]}
0|owlia-ai-agent  | [API] Calling real API for get_lp_simulate_batch
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_lp_simulate_batch returned keys: 0, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [RebalancePrecheckService] get_lp_simulate_batch response: {"0":{"timestamp":1761811533460,"summary":{"totalLiquidityUSD":989.9438,"totalExpectedAPY":7.824424493918161,"totalExpectedDailyReturn":21.22120689403403,"requiredTokens":{"token0":{"amount":695.944870392853,"amountUSD":695.944870392853,"percentage":70.30145250597589},"token1":{"amount":293.99892960714703,"amountUSD":293.99892960714703,"percentage":29.69854749402411}}},"pool":{"poolAddress":"0xa41bc0affba7fd420d186b84899d7ab2ac57fcd1","inputAmountUSD":989.9438,"position":{"tickLower":9,"tickUpper":10,"currentTick":9,"inRange":true,"priceRange":{"lower":1.0009003600840125,"upper":1.001000450120021,"current":1.0009301042795982},"token0Amount":695.944870392853,"token1Amount":293.99892960714703},"before":{"totalLiquidityUSD":1592054.4858884744,"apy":7.831734316779955,"tvl":1592054.4858884744},"after":{"totalLiquidityUSD":1593044.4296884744,"estimatedAPY":7.824424493918161,"tvl":1593044.4296884744,"yourShare":0.062141631554719856}}},"_dataSource":"api"}
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool get_supply_opportunities with input {"chain_id":"8453","amount":989.9438}
0|owlia-ai-agent  | [API] Calling real API for get_supply_opportunities
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_supply_opportunities returned keys: opportunities, summary, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [RebalancePrecheckService] get_supply_opportunities response: {"opportunities":[{"protocol":"aave","asset":"USDC","before":{"supplyAPY":5.033500559586668,"totalSupplyUSD":392501576.87602,"utilization":0.7972969851193517},"after":{"supplyAPY":5.033478494995713,"totalSupplyUSD":392502566.69112736,"utilization":79.72949744914784},"changes":{"apyDelta":-0.000022064590954329333,"apyDeltaPercent":-0.0004383547929145595,"expectedAnnualReturn":49.828608285543375}},{"protocol":"euler","asset":"USDC","vault_address":"0x0A1a3b5f2041F33522C4efc754a7D096f880eE16","before":{"supplyAPY":4.736930664089047,"totalSupplyUSD":1650293.1378784955,"utilization":81.11383454756275},"after":{"supplyAPY":4.701801782951298,"totalSupplyUSD":1651283.0816780692,"utilization":81.06520682378783},"changes":{"apyDelta":-0.03512888113774881,"apyDeltaPercent":-0.74159584821587,"expectedAnnualReturn":46.54519523861583}},{"protocol":"euler","asset":"USDC","vault_address":"0xC063C3b3625DF5F362F60f35B0bcd98e0fa650fb","before":{"supplyAPY":1.1512165897700106,"totalSupplyUSD":17223.33525930408,"utilization":31.770986420873054},"after":{"supplyAPY":1.0574303109907701,"totalSupplyUSD":18213.27905887791,"utilization":30.044142456531727},"changes":{"apyDelta":-0.0937862787792405,"apyDeltaPercent":-8.146710151039178,"expectedAnnualReturn":10.467965802973847}},{"protocol":"euler","asset":"USDC","vault_address":"0x4C1aeda9B43EfcF1da1d1755b18802aAbe90f61E","before":{"supplyAPY":4.174118545457514,"totalSupplyUSD":733.8511678970274,"utilization":93.8324026361723},"after":{"supplyAPY":0.7404184363686506,"totalSupplyUSD":1723.7949674686195,"utilization":39.946176639706835},"changes":{"apyDelta":-3.4337001090888633,"apyDeltaPercent":-82.26168163876392,"expectedAnnualReturn":7.329726404888402}},{"protocol":"euler","asset":"USDC","vault_address":"0x085178078796Da17B191f9081b5E2fCCc79A7eE7","before":{"supplyAPY":7.871796523920358,"totalSupplyUSD":1027474.906106,"utilization":86.61084944445275},"after":{"supplyAPY":0,"totalSupplyUSD":1028464.849906,"utilization":86.52748259586468},"changes":{"apyDelta":-7.871796523920358,"apyDeltaPercent":-100,"expectedAnnualReturn":0}},{"protocol":"euler","asset":"USDC","vault_address":"0x611745c9107d0197f161556691c5129fD9B898D1","before":{"supplyAPY":0,"totalSupplyUSD":0,"utilization":0},"after":{"supplyAPY":0,"totalSupplyUSD":989.9437995738299,"utilization":0},"changes":{"apyDelta":0,"apyDeltaPercent":0,"expectedAnnualReturn":0}}],"summary":{"total_opportunities":6,"average_apy_before":3.8279271471372662,"average_apy_after":1.9221881708844055,"best_opportunity":{"protocol":"aave","asset":"USDC","before":{"supplyAPY":5.033500559586668,"totalSupplyUSD":392501576.87602,"utilization":0.7972969851193517},"after":{"supplyAPY":5.033478494995713,"totalSupplyUSD":392502566.69112736,"utilization":79.72949744914784},"changes":{"apyDelta":-0.000022064590954329333,"apyDeltaPercent":-0.0004383547929145595,"expectedAnnualReturn":49.828608285543375}},"input_amount":989.9438},"_dataSource":"api"}
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [RebalancePrecheckService] Found 7 opportunities for optimization
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [MarginalOptimizerService] Starting marginal optimization with 7 opportunities, total capital=$989.9438, increment=$494.9719, initial holdings={"USDC":695.8276,"USDT":294.39889999999997}
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Querying real-time Supply APY for USDC at $247.49
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool get_supply_opportunities with input {"chain_id":"8453","amount":247.48595}
0|owlia-ai-agent  | [API] Calling real API for get_supply_opportunities
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_supply_opportunities returned keys: opportunities, summary, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Got real-time APY: 5.03% (vs estimated: 5.03%)
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Querying real-time Supply APY for USDC at $247.49
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool get_supply_opportunities with input {"chain_id":"8453","amount":247.48595}
0|owlia-ai-agent  | [API] Calling real API for get_supply_opportunities
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_supply_opportunities returned keys: opportunities, summary, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Got real-time APY: 5.03% (vs estimated: 4.70%)
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Querying real-time Supply APY for USDC at $247.49
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool get_supply_opportunities with input {"chain_id":"8453","amount":247.48595}
0|owlia-ai-agent  | [API] Calling real API for get_supply_opportunities
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_supply_opportunities returned keys: opportunities, summary, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Got real-time APY: 5.03% (vs estimated: 1.06%)
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Querying real-time Supply APY for USDC at $247.49
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool get_supply_opportunities with input {"chain_id":"8453","amount":247.48595}
0|owlia-ai-agent  | [API] Calling real API for get_supply_opportunities
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_supply_opportunities returned keys: opportunities, summary, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Got real-time APY: 5.03% (vs estimated: 0.74%)
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Querying real-time Supply APY for USDC at $247.49
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool get_supply_opportunities with input {"chain_id":"8453","amount":247.48595}
0|owlia-ai-agent  | [API] Calling real API for get_supply_opportunities
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_supply_opportunities returned keys: opportunities, summary, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Got real-time APY: 5.03% (vs estimated: 0.00%)
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Querying real-time Supply APY for USDC at $247.49
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool get_supply_opportunities with input {"chain_id":"8453","amount":247.48595}
0|owlia-ai-agent  | [API] Calling real API for get_supply_opportunities
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_supply_opportunities returned keys: opportunities, summary, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Got real-time APY: 5.03% (vs estimated: 0.00%)
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Querying real-time LP APY for pool 0xa41bc0af... at $247.49
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool get_lp_simulate_batch with input {"reqs":[{"chain_id":"8453","poolOperation":{"poolAddress":"0xa41bc0affba7fd420d186b84899d7ab2ac57fcd1","operation":"add","amountUSD":247.48595,"tickLower":9,"tickUpper":10,"timeHorizon":30},"priceImpact":false,"includeIL":true}]}
0|owlia-ai-agent  | [API] Calling real API for get_lp_simulate_batch
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_lp_simulate_batch returned keys: 0, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Got real-time APY: 7.83% (vs estimated: 31.29%)
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM   DEBUG [MarginalOptimizerService] Allocated $494.9719 to lp-0xa41bc0affba7fd420d186b84899d7ab2ac57fcd1: used={"USDC":347.9724351964265,"USDT":146.99946480357352}, newly swapped=[], total used={"USDC":347.9724351964265,"USDT":146.99946480357352}
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [MarginalOptimizerService] Iteration 1: Allocated $494.97 to lp-0xa41bc0affba7fd420d186b84899d7ab2ac57fcd1, marginal netAPY=5.48% (gross=5.48%), breakeven=0.00h, swapCost=$0.00, total to this opp=$494.97, remaining=$494.97
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Querying real-time LP APY for pool 0xa41bc0af... at $742.46
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool get_lp_simulate_batch with input {"reqs":[{"chain_id":"8453","poolOperation":{"poolAddress":"0xa41bc0affba7fd420d186b84899d7ab2ac57fcd1","operation":"add","amountUSD":742.45785,"tickLower":9,"tickUpper":10,"timeHorizon":30},"priceImpact":false,"includeIL":true}]}
0|owlia-ai-agent  | [API] Calling real API for get_lp_simulate_batch
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Tool get_lp_simulate_batch returned keys: 0, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [APYCalculatorService] Got real-time APY: 7.83% (vs estimated: 10.43%)
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM   DEBUG [MarginalOptimizerService] Allocated $494.9719 to supply-aave-USDC: used={"USDC":494.9719}, newly swapped=["USDC"], total used={"USDC":842.9443351964264,"USDT":146.99946480357352}
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [MarginalOptimizerService] Iteration 2: Allocated $494.97 to supply-aave-USDC, marginal netAPY=4.89% (gross=5.03%), breakeven=4.92h, swapCost=$0.01, total to this opp=$494.97, remaining=$0.00
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [MarginalOptimizerService] Optimization complete: 2 positions, invested=$989.94/989.94, weighted APY=10.34%, total swap cost=$0.01
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [RebalancePrecheckService] Built 1 strategies for user e5051acd-95eb-4494-a1fc-c0b9f9e6c441
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:33 PM     LOG [AgentService] Calling MCP tool calculate_rebalance_cost_batch with input {"safeAddress":"0xcd16c350a8df6ab7eabbe9c28a440684bc664f93","wallet_address":"0xcd16c350a8df6ab7eabbe9c28a440684bc664f93","chain_id":"8453","target_positions_batch":[{"targetLendingSupplyPositions":[{"protocol":"aave","token":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","vToken":null,"amount":"494.9719"}],"targetLiquidityPositions":[{"protocol":"aerodromeSlipstream","poolAddress":"0xa41bc0affba7fd420d186b84899d7ab2ac57fcd1","token0Address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913","token1Address":"0xfde4c96c8593536e31f229ea8f37b2ada2699bb2","targetTickLower":9,"targetTickUpper":10,"targetAmount0":"347.9724351964265","targetAmount1":"146.99946480357352"}]}]}
0|owlia-ai-agent  | [API] Calling real API for calculate_rebalance_cost_batch
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:34 PM     LOG [AgentService] Tool calculate_rebalance_cost_batch returned keys: 0, _dataSource
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:34 PM     LOG [RebalancePrecheckService] Strategy 0 (Strategy Conservative: Marginal Optimized): APY=10.34%, swap_fee=$0.0000, break-even=0.00h, score=0.0683
0|owlia-ai-agent  | [Nest] 3453803  - 10/30/2025, 4:05:34 PM     LOG [RebalancePrecheckService] Precheck APPROVED for user e5051acd-95eb-4494-a1fc-c0b9f9e6c441: Portfolio APY=7.82%, Opportunity APY=10.34%, Strategy=Strategy Conservative: Marginal Optimized, USDC(supply/aave): $494.97 (50.0%), 0xa41bc0(lp/AerodromeSlipstream): $494.97 (50.0%)
`;

async function loadLogFile(filePath: string): Promise<string> {
  try {
    const absolutePath = path.resolve(filePath);
    return fs.readFileSync(absolutePath, 'utf-8');
  } catch (error) {
    console.error(`Error reading log file: ${(error as Error).message}`);
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting Rebalance Summary Test');
  console.log(`   Model: ${process.env.MODEL || 'claude-3-5-sonnet-20241022'}\n`);

  // Get log data from file or use sample
  let rebalanceLog: string;
  const logFilePath = process.argv[2];

  if (logFilePath) {
    console.log(`📄 Loading rebalance log from: ${logFilePath}`);
    rebalanceLog = await loadLogFile(logFilePath);
  } else {
    console.log('📄 Using sample rebalance log (no file specified)\n');
    rebalanceLog = SAMPLE_REBALANCE_LOG;
  }

  console.log('='.repeat(80));
  console.log('INPUT: Rebalance Log');
  console.log('='.repeat(80));
  console.log(rebalanceLog.substring(0, 500) + '...\n');

  // Generate prompt
  const prompt = getRebalanceSummaryPrompt(rebalanceLog);

  // Create mock ConfigService and initialize AgentService
  console.log('🔧 Initializing AgentService...');
  const configService = new MockConfigService();
  const agentService = new AgentService(configService);

  try {
    // Initialize the service (connects to MCP)
    await agentService.onModuleInit();
    console.log('✓ AgentService initialized\n');

    console.log('='.repeat(80));
    console.log('Processing with AgentService...');
    console.log('='.repeat(80));

    // Call AgentService's simple completion method
    const summary = await agentService.runSimpleCompletion(prompt);

    console.log('\n' + '='.repeat(80));
    console.log('✅ Summary Generated Successfully!');
    console.log('='.repeat(80));
    console.log('\n' + summary + '\n');

  } catch (error) {
    console.error('\n❌ Error calling AgentService:', error);
    throw error;
  } finally {
    // Cleanup
    await agentService.onModuleDestroy();
    console.log('\n🔌 AgentService disconnected');
  }
}

main().catch(error => {
  console.error('\n\n❌ Test failed:', error);
  console.error(error.stack);
  process.exit(1);
});
