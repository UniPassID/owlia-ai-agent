import { TransactionParserService } from '../src/monitor/transaction-parser.service';

/**
 * Test script for parsing KyberSwap transaction
 * Transaction: https://bscscan.com/tx/0x7715464e5c650f84277c16fceb9e1ec11d678c4eeaba4e270cb5c01a32ed38f8
 */
async function main() {
  const txHash = '0x7715464e5c650f84277c16fceb9e1ec11d678c4eeaba4e270cb5c01a32ed38f8';
  const chainId = '56'; // BNB Chain (BSC) chain ID

  console.log('Testing KyberSwap transaction parsing...');
  console.log(`Transaction: ${txHash}`);
  console.log(`Chain ID: ${chainId} (BNB Chain)`);
  console.log('---\n');

  const parser = new TransactionParserService();

  try {
    const parsed = await parser.parseTransaction(txHash, chainId);

    console.log('✅ Transaction parsed successfully!\n');

    // Format and display the results
    const formatted = parser.formatParsedTransaction(parsed);
    console.log(formatted);

    console.log('\n---\nRaw parsed data:');
    console.log(JSON.stringify(parsed, (key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    , 2));

  } catch (error) {
    console.error('❌ Error parsing transaction:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
