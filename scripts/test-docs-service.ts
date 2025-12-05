/**
 * Standalone script to test DocService.answerWithDocs function
 *
 * Usage:
 *   # Ask a custom question
 *   npx ts-node scripts/test-docs-service.ts "What is Owlia?"
 *
 *   # Ask a question with custom system prompt
 *   npx ts-node scripts/test-docs-service.ts "Summarize the features" --system "Be very brief"
 *
 *   # Run default test suite
 *   npx ts-node scripts/test-docs-service.ts --test-all
 *
 * Make sure to set ANTHROPIC_API_KEY in your .env file
 */

import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { DocService } from '../src/modules/agent/docs.service';

// Load environment variables
config();

function parseArgs() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Usage:
  npx ts-node scripts/test-docs-service.ts <question> [options]
  npx ts-node scripts/test-docs-service.ts --test-all

Options:
  --system <prompt>    Custom system prompt
  --test-all          Run all default tests
  -h, --help          Show this help message

Examples:
  npx ts-node scripts/test-docs-service.ts "What is Owlia?"
  npx ts-node scripts/test-docs-service.ts "Explain DeFi" --system "Be concise"
  npx ts-node scripts/test-docs-service.ts --test-all
    `);
    process.exit(0);
  }

  const testAll = args.includes('--test-all');
  const systemIndex = args.indexOf('--system');
  const systemPrompt = systemIndex !== -1 ? args[systemIndex + 1] : undefined;

  // Get the question (first argument that's not a flag)
  const question = args.find(arg => !arg.startsWith('--') && arg !== systemPrompt);

  return { question, systemPrompt, testAll };
}

async function runSingleTest(docService: DocService, question: string, systemPrompt?: string) {
  console.log('='.repeat(60));
  console.log('DocService.answerWithDocs Test');
  console.log('='.repeat(60));
  console.log('\nQuestion:', question);
  if (systemPrompt) {
    console.log('System Prompt:', systemPrompt);
  }
  console.log('\nSending request...\n');

  const startTime = Date.now();
  const response = await docService.answerWithDocs(question, systemPrompt);
  const duration = Date.now() - startTime;

  console.log('-'.repeat(60));
  console.log('Response:');
  console.log('-'.repeat(60));
  console.log(response);
  console.log('\n' + '='.repeat(60));
  console.log(`✅ Completed in ${(duration / 1000).toFixed(2)}s`);
  console.log('='.repeat(60));
}

async function runAllTests(docService: DocService) {
  console.log('='.repeat(60));
  console.log('Running All Tests for DocService.answerWithDocs');
  console.log('='.repeat(60));

  try {
    // Test 1: Simple question
    console.log('\n[Test 1] Simple Question');
    console.log('-'.repeat(60));
    const question1 = 'What is Owlia?';
    console.log('Question:', question1);
    console.log('Sending request...\n');

    const response1 = await docService.answerWithDocs(question1);

    console.log('Response:');
    console.log(response1);
    console.log('\n' + '='.repeat(60));

    // Wait a bit to avoid throttling
    console.log('\nWaiting 6 seconds before next request (throttling)...\n');
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Test 2: Question with custom system prompt
    console.log('\n[Test 2] Custom System Prompt');
    console.log('-'.repeat(60));
    const question2 = 'Summarize the main features.';
    const systemPrompt = 'You are a helpful assistant. Provide a brief summary in 2-3 sentences.';
    console.log('Question:', question2);
    console.log('System Prompt:', systemPrompt);
    console.log('Sending request...\n');

    const response2 = await docService.answerWithDocs(question2, systemPrompt);

    console.log('Response:');
    console.log(response2);
    console.log('\n' + '='.repeat(60));

    // Wait a bit to avoid throttling
    console.log('\nWaiting 6 seconds before next request (throttling)...\n');
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Test 3: Feature-specific question
    console.log('\n[Test 3] Feature-Specific Question');
    console.log('-'.repeat(60));
    const question3 = 'What DeFi features does Owlia support?';
    console.log('Question:', question3);
    console.log('Sending request...\n');

    const response3 = await docService.answerWithDocs(question3);

    console.log('Response:');
    console.log(response3);
    console.log('\n' + '='.repeat(60));

    console.log('\n✅ All tests completed successfully!\n');
  } catch (error) {
    console.error('\n❌ Error during testing:');
    console.error(error);
    process.exit(1);
  }
}

async function main() {
  const { question, systemPrompt, testAll } = parseArgs();

  // Validate environment
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY is not set in .env file');
    process.exit(1);
  }

  // Create a mock ConfigService
  const configService = new ConfigService({
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    MODEL: process.env.MODEL || 'claude-3-5-sonnet-20241022',
  });

  // Create DocService instance
  const docService = new DocService(configService);

  // Initialize the service (normally done by NestJS)
  docService.onModuleInit();

  try {
    if (testAll) {
      await runAllTests(docService);
    } else if (question) {
      await runSingleTest(docService, question, systemPrompt);
    } else {
      console.error('❌ Error: Please provide a question or use --test-all');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Error during testing:');
    console.error(error);
    process.exit(1);
  }
}

// Run the main function
main()
  .then(() => {
    console.log('\n🎉 Script finished successfully');
    process.exit(0);
  })
  .catch(error => {
    console.error('\n💥 Script failed:');
    console.error(error);
    process.exit(1);
  });
