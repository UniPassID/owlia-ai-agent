#!/usr/bin/env ts-node

/**
 * Test script for rebalance summary generation
 * Uses the getRebalanceSummaryPrompt to analyze rebalancing logs and generate user-friendly summaries
 *
 * Usage: npx ts-node scripts/test-rebalance-summary.ts [filename]
 *
 * Examples:
 *   npx ts-node scripts/test-rebalance-summary.ts                                      # Uses first available .log file
 *   npx ts-node scripts/test-rebalance-summary.ts user-xxx-2025-10-30_09-25-07-660.log # Loads specific log file
 *   npx ts-node scripts/test-rebalance-summary.ts user-xxx-2025-10-30_09-25-07-660     # Auto-adds .log extension
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

// Directory containing sample log files
const LOG_SAMPLE_DIR = path.join(__dirname, '../logs-sample/2025-10-30');

/**
 * List all available .log files in the sample directory
 */
function listAvailableLogFiles(): string[] {
  if (!fs.existsSync(LOG_SAMPLE_DIR)) {
    return [];
  }
  return fs.readdirSync(LOG_SAMPLE_DIR)
    .filter(file => file.endsWith('.log'))
    .sort();
}

/**
 * Load a log file from the sample directory
 * Supports both with and without .log extension
 */
async function loadLogFile(filename: string): Promise<string> {
  try {
    // Auto-add .log suffix if not present
    const normalizedFilename = filename.endsWith('.log') ? filename : `${filename}.log`;
    const filePath = path.join(LOG_SAMPLE_DIR, normalizedFilename);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Log file not found: ${normalizedFilename}\nPath: ${filePath}`);
    }

    return fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    console.error(`Error reading log file: ${(error as Error).message}`);
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting Rebalance Summary Test');
  console.log(`   Model: ${process.env.MODEL || 'claude-3-5-sonnet-20241022'}\n`);

  // Get filename from command line argument
  let filename = process.argv[2];
  let rebalanceLog: string;

  // If no filename provided, auto-select first available file
  if (!filename) {
    const availableFiles = listAvailableLogFiles();

    if (availableFiles.length === 0) {
      console.error('❌ No log files found in:', LOG_SAMPLE_DIR);
      console.error('\nPlease add .log files to the directory or specify a file:');
      console.error('Usage: npx ts-node scripts/test-rebalance-summary.ts <filename>');
      process.exit(1);
    }

    // Auto-select first file
    filename = availableFiles[0];
    console.log(`📄 No file specified, using default: ${filename}\n`);
  }

  // Load the log file
  console.log(`📄 Loading rebalance log from: logs-sample/2025-10-30/${filename}`);
  rebalanceLog = await loadLogFile(filename);

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
    console.log('AI Response Processing');
    console.log('='.repeat(80));

    // Extract JSON from response (AI might wrap it in markdown code blocks)
    const jsonMatch = summary.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('❌ AI did not return valid JSON');
      console.error('Raw response:', summary);
      throw new Error('Invalid JSON response from AI');
    }

    // Parse JSON
    const parsed = JSON.parse(jsonMatch[0]);

    // Validate field lengths
    console.log('\n📏 Field Length Validation:');
    const titleLen = parsed.title?.length || 0;
    const summaryLen = parsed.summary?.length || 0;
    console.log(`  title: ${titleLen}/30 chars ${titleLen <= 30 ? '✓' : '⚠️  EXCEEDS LIMIT'}`);
    console.log(`  summary: ${summaryLen}/50 chars ${summaryLen <= 50 ? '✓' : '⚠️  EXCEEDS LIMIT'}`);

    if (parsed.steps && Array.isArray(parsed.steps)) {
      parsed.steps.forEach((step: any, idx: number) => {
        const contentLen = step.content?.length || 0;
        const reasonLen = step.metadata?.reason?.length || 0;

        // Step 1 has different limits
        if (idx === 0) {
          console.log(`  step[${idx}].content: ${contentLen}/35 chars ${contentLen <= 35 ? '✓' : '⚠️  EXCEEDS LIMIT'}`);
          console.log(`  step[${idx}].reason: ${reasonLen}/100 chars ${reasonLen <= 100 ? '✓' : '⚠️  EXCEEDS LIMIT'}`);
        } else {
          console.log(`  step[${idx}].content: ${contentLen}/50 chars ${contentLen <= 50 ? '✓' : '⚠️  EXCEEDS LIMIT'}`);
          console.log(`  step[${idx}].reason: ${reasonLen}/300 chars ${reasonLen <= 300 ? '✓' : '⚠️  EXCEEDS LIMIT'}`);
        }
      });
    }

    // Display parsed result
    console.log('\n' + '='.repeat(80));
    console.log('✅ Parsed TimelineMessage');
    console.log('='.repeat(80));
    console.log('\n' + JSON.stringify(parsed, null, 2) + '\n');

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
