/**
 * Test script for RebalancePrecheckService
 * Usage: npx ts-node scripts/test-precheck.ts [address] [chainId]
 * Example: npx ts-node scripts/test-precheck.ts 0x1234567890abcdef1234567890abcdef12345678 8453
 */

import { config } from 'dotenv';
import { RebalancePrecheckService } from '../src/monitor/rebalance-precheck.service';
import { AgentService } from '../src/agent/agent.service';
import { ConfigService } from '@nestjs/config';
import { UserV2Deployment, UserV2DeploymentStatus } from '../src/entities/user-v2-deployment.entity';
import { MarginalOptimizerService } from '../src/monitor/portfolio-optimizer/marginal-optimizer.service';
import { OpportunityConverterService } from '../src/monitor/portfolio-optimizer/opportunity-converter.service';
import { CostCalculatorService } from '../src/monitor/portfolio-optimizer/cost-calculator.service';
import { APYCalculatorService } from '../src/monitor/portfolio-optimizer/apy-calculator.service';
import { randomUUID } from 'crypto';

// Load environment variables
config();

/**
 * Helper to convert hex address to 32-byte Buffer
 */
function addressToBuffer(address: string): Buffer {
  const hex = address.startsWith('0x') ? address.slice(2) : address;
  // Pad to 64 hex chars (32 bytes) with leading zeros
  return Buffer.from(hex.padStart(40, '0'), 'hex');
}

/**
 * Mock UserV2Deployment object for testing
 */
function createMockDeployment(address: string, chainId: string): UserV2Deployment {
  const deployment = new UserV2Deployment();
  deployment.id = randomUUID();
  deployment.userId = `test-user-${Date.now()}`;
  deployment.chainId = parseInt(chainId, 10);

  // Convert addresses to Buffer (required by entity definition)
  const addressBuffer = addressToBuffer(address);
  deployment.address = addressBuffer;
  deployment.operator = addressBuffer; // Use same address for testing
  deployment.guard = addressBuffer;    // Use same address for testing
  deployment.setGuardSignature = null;

  deployment.status = UserV2DeploymentStatus.setGuardSuccess;
  deployment.createdAt = new Date();
  deployment.updatedAt = new Date();

  return deployment;
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

    // Initialize portfolio optimizer services
    console.log('Initializing portfolio optimizer services...');
    const apyCalculator = new APYCalculatorService(agentService);
    const costCalculator = new CostCalculatorService(agentService);
    const marginalOptimizer = new MarginalOptimizerService(costCalculator);
    const opportunityConverter = new OpportunityConverterService(apyCalculator);
    console.log('Portfolio optimizer services initialized\n');

    // Initialize RebalancePrecheckService
    const precheckService = new RebalancePrecheckService(
      agentService,
      marginalOptimizer,
      opportunityConverter,
    );

    // Create mock deployment
    const mockDeployment = createMockDeployment(address, chainId);

    console.log('Starting precheck evaluation...');
    console.log('-'.repeat(80));

    const startTime = Date.now();

    // Run the evaluation
    const result = await precheckService.evaluate(mockDeployment);

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

    if (result.strategyEvaluations !== undefined) {
      console.log(`\nStrategy Evaluations:`);
      console.log(JSON.stringify(result.strategyEvaluations, null, 2));
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
