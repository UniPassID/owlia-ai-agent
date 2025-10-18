#!/usr/bin/env ts-node

/**
 * Test script for manual_trigger agent flow
 * Directly calls AgentService.runRebalanceAgent() without database dependency
 *
 * Usage: npx ts-node scripts/test-manual-trigger.ts <wallet_address> [chain_id]
 *
 * Example:
 *   npx ts-node scripts/test-manual-trigger.ts 0x1234...5678
 *   npx ts-node scripts/test-manual-trigger.ts 0x1234...5678 base
 */

import * as dotenv from 'dotenv';
import { AgentService } from '../src/agent/agent.service';
import { ConfigService } from '@nestjs/config';
import { AgentContext } from '../src/agent/agent.types';

// Load environment variables
dotenv.config();

const WALLET_ADDRESS = process.argv[2];
const CHAIN_ID = process.argv[3] || 'base'; // Default to Base

if (!WALLET_ADDRESS) {
  console.error('Error: Wallet address is required');
  console.log('Usage: npx ts-node scripts/test-manual-trigger.ts <wallet_address> [chain_id]');
  process.exit(1);
}

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

async function main() {
  console.log('🚀 Starting manual_trigger test via AgentService');
  console.log(`   Wallet: ${WALLET_ADDRESS}`);
  console.log(`   Chain ID: ${CHAIN_ID}`);
  console.log(`   Model: ${process.env.MODEL || 'claude-3-5-sonnet-20241022'}\n`);

  // Create mock ConfigService
  const configService = new MockConfigService();

  // Create AgentService instance
  console.log('🔧 Initializing AgentService...');
  const agentService = new AgentService(configService);

  // Initialize the service (connects to MCP)
  await agentService.onModuleInit();
  console.log('✓ AgentService initialized\n');

  try {
    // Build AgentContext with mock data
    const context: AgentContext = {
      userId: 'test-user-id',
      userAddress: WALLET_ADDRESS,
      jobId: `test-job-${Date.now()}`,
      userPolicy: {
        chains: [CHAIN_ID],
        assetWhitelist: [],
        minAprLiftBps: 50,
        minNetUsd: 10,
        minHealthFactor: 1.5,
        maxSlippageBps: 100,
        maxGasUsd: 50,
        maxPerTradeUsd: 10000,
      },
      trigger: 'manual_trigger',
    };

    console.log('🤖 Running agent with context:');
    console.log(JSON.stringify(context, null, 2));
    console.log('\n' + '='.repeat(80));
    console.log('Starting agent execution...');
    console.log('='.repeat(80) + '\n');

    // Run the agent
    const result = await agentService.runRebalanceAgent(context);

    // Display results
    console.log('\n' + '='.repeat(80));
    console.log('✅ Agent execution completed!');
    console.log('='.repeat(80));
    console.log('\nResult summary:');
    console.log(`  Success: ${result.success}`);
    console.log(`  Action: ${result.action}`);
    if (result.error) {
      console.log(`  Error: ${result.error}`);
    }

    if (result.data) {

      if(result.data.summary ) {
      console.log('\n' + '='.repeat(80));
      console.log('SUMMARY:');
      console.log('='.repeat(80));
        console.log(result.data.summary)
      }

      console.log('\n' + '='.repeat(80));
      console.log('RECOMMENDATION:');
      console.log('='.repeat(80));
      if (result.data.reasoning) {
        console.log(result.data.reasoning);
      }


      if (result.data.plan) {
        console.log('\n📋 Rebalance Plan:');
        console.log(`  Should Rebalance: ${result.data.plan.shouldRebalance}`);
        console.log(`  Recommendation: ${result.data.plan.recommendation}`);

        if (result.data.plan.opportunities && result.data.plan.opportunities.length > 0) {
          console.log(`\n  Opportunities (${result.data.plan.opportunities.length}):`);
          result.data.plan.opportunities.forEach((opp: any, idx: number) => {
            console.log(`    ${idx + 1}. ${opp.type} - ${opp.protocol}`);
            if (opp.expectedAPY) {
              console.log(`       Expected APY: ${opp.expectedAPY.toFixed(2)}%`);
            }
          });
        }

        if (result.data.plan.costEstimates && result.data.plan.costEstimates.length > 0) {
          console.log('\n  Cost Estimates:');
          result.data.plan.costEstimates.forEach((est: any) => {
            console.log(`    - ${est.name || 'Strategy'}`);
            if (est.gasEstimate) console.log(`      Gas: $${est.gasEstimate.toFixed(4)}`);
            if (est.breakEvenTime) console.log(`      Break-even: ${est.breakEvenTime}`);
          });
        }
      }

      if (result.data.step1Summary) {
        console.log('\n📊 Portfolio Summary:');
        console.log(`  Total Assets: $${result.data.step1Summary.totalAssetsUsd.toFixed(2)}`);
        console.log(`  Portfolio APY: ${result.data.step1Summary.portfolioApy.toFixed(2)}%`);
      }

      if (result.data.step2Summary) {
        console.log('\n🔍 Market Opportunities:');
        if (result.data.step2Summary.bestLpOpportunity) {
          const lp = result.data.step2Summary.bestLpOpportunity as any;
          console.log(`  Best LP: ${lp.poolName} - ${lp.expectedAPY?.toFixed(2)}% APY`);
        }
        if (result.data.step2Summary.bestSupplyOpportunity) {
          const supply = result.data.step2Summary.bestSupplyOpportunity as any;
          console.log(`  Best Supply: ${supply.protocol} ${supply.tokenSymbol} - ${supply.expectedAPY?.toFixed(2)}% APY`);
        }
      }

      console.log('\n' + '='.repeat(80));
    }

    // Display raw result for debugging
    // console.log('\n📄 Full result object:');
    // console.log(JSON.stringify(result));

  } finally {
    // Cleanup
    await agentService.onModuleDestroy();
    console.log('\n\n🔌 AgentService disconnected');
  }
}

main().catch(error => {
  console.error('\n\n❌ Test failed:', error);
  console.error(error.stack);
  process.exit(1);
});
