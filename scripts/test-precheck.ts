/**
 * Test script for RebalancePrecheckService
 * Usage: npx ts-node scripts/test-precheck.ts [address] [chainId]
 * Example: npx ts-node scripts/test-precheck.ts 0x1234567890abcdef1234567890abcdef12345678 8453
 */

import { config } from 'dotenv';
import { RebalancePrecheckService } from '../src/monitor/rebalance-precheck.service';
import { AgentService } from '../src/agent/agent.service';
import { ConfigService } from '@nestjs/config';
import { User } from '../src/entities/user.entity';
import { UserPolicy } from '../src/entities/user-policy.entity';

// Load environment variables
config();

// Mock User object
function createMockUser(address: string, chainId: string): User {
  const user = new User();
  user.id = `test-user-${Date.now()}`;
  user.address = address;
  user.safeOwner = address; // Use same address as safe owner
  user.chainId = chainId;
  user.createdAt = new Date();
  user.updatedAt = new Date();
  return user;
}

// Mock UserPolicy object (optional, can be null)
function createMockPolicy(userId: string): UserPolicy | null {
  const policy = new UserPolicy();
  policy.userId = userId;
  policy.chains = ['8453', '1']; // Base and Ethereum
  policy.assetWhitelist = [];
  policy.minAprLiftBps = 50; // 0.5%
  policy.minNetUsd = 10;
  policy.minHealthFactor = 1.5;
  policy.maxSlippageBps = 100; // 1%
  policy.maxGasUsd = 50;
  policy.maxPerTradeUsd = 10000;
  policy.autoEnabled = true;
  policy.createdAt = new Date();
  policy.updatedAt = new Date();
  return policy;
}

// Main test function
async function testPrecheck() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const address = args[0] || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0'; // Default test address
  const chainId = args[1] || '8453'; // Default to Base

  console.log('='.repeat(80));
  console.log('Testing RebalancePrecheckService');
  console.log('='.repeat(80));
  console.log(`Address: ${address}`);
  console.log(`Chain ID: ${chainId}`);
  console.log('');

  try {
    // Initialize ConfigService
    const configService = new ConfigService({
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      MODEL: process.env.MODEL || 'claude-3-5-sonnet-20241022',
      MCP_SERVER_COMMAND: process.env.MCP_SERVER_COMMAND || 'npx',
      MCP_SERVER_ARGS: process.env.MCP_SERVER_ARGS || '-y,@modelcontextprotocol/server-defi',
    });

    // Initialize AgentService
    console.log('Initializing AgentService...');
    const agentService = new AgentService(configService);
    await agentService.onModuleInit();
    console.log('AgentService initialized\n');

    // Initialize RebalancePrecheckService
    const precheckService = new RebalancePrecheckService(agentService);

    // Create mock user and policy
    const mockUser = createMockUser(address, chainId);
    const mockPolicy = createMockPolicy(mockUser.id);

    console.log('Starting precheck evaluation...');
    console.log('-'.repeat(80));

    const startTime = Date.now();

    // Run the evaluation
    const result = await precheckService.evaluate(mockUser, mockPolicy);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log('-'.repeat(80));
    console.log('Precheck completed in', duration, 'seconds\n');

    // Display results
    console.log('='.repeat(80));
    console.log('PRECHECK RESULT');
    console.log('='.repeat(80));
    console.log(`Should Trigger:         ${result.shouldTrigger ? '✅ YES' : '❌ NO'}`);
    console.log(`Portfolio APY:          ${result.portfolioApy.toFixed(2)}%`);
    console.log(`Opportunity APY:        ${result.opportunityApy.toFixed(2)}%`);
    console.log(`Difference:             ${result.differenceBps.toFixed(2)} bps`);
    console.log(`Total Portfolio Value:  $${result.totalPortfolioValueUsd.toFixed(2)}`);

    if (result.gasEstimate !== undefined) {
      console.log(`Gas Estimate:           $${result.gasEstimate.toFixed(2)}`);
    }
    if (result.breakEvenTimeHours !== undefined) {
      console.log(`Break-even Time:        ${result.breakEvenTimeHours.toFixed(2)} hours`);
    }
    if (result.netGainUsd !== undefined) {
      console.log(`Net Gain:               $${result.netGainUsd.toFixed(2)}`);
    }
    if (result.failureReason) {
      console.log(`Failure Reason:         ${result.failureReason}`);
    }

    console.log('='.repeat(80));

    // Display detailed yield summary if available
    if (result.yieldSummary) {
      console.log('\nYield Summary:');
      console.log(JSON.stringify(result.yieldSummary, null, 2));
    }

    // Cleanup
    await agentService.onModuleDestroy();
    console.log('\nTest completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error during precheck test:');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
testPrecheck();
