#!/usr/bin/env ts-node

/**
 * Test script for transaction parser service
 * Parses rebalance transactions from blockchain to extract actions
 *
 * Usage: npx ts-node scripts/test-transaction-parser.ts [txHash] [chainId]
 *
 * Examples:
 *   npx ts-node scripts/test-transaction-parser.ts                                                    # Uses default BSC transaction
 *   npx ts-node scripts/test-transaction-parser.ts 0x9448d40a76b5170877ea49f3c2d400baf4a71d7b3f05c415a01e392b82fbdb2b 56  # BSC transaction
 *   npx ts-node scripts/test-transaction-parser.ts 0x123... 8453                                      # Base transaction
 *   npx ts-node scripts/test-transaction-parser.ts --jobs                                             # Fetch latest rebalance jobs and build timeline
 */

import * as dotenv from 'dotenv';
import axios from 'axios';
import { ethers } from 'ethers';
import * as fs from 'fs';
import { TransactionParserService } from '../src/monitor/transaction-parser.service';
import { Protocol, RebalanceActionType, TokenAmount } from '../src/monitor/types/transaction-parser.types';

// Load environment variables
dotenv.config();

// Default test transaction (BSC)
const DEFAULT_TX_HASH = '0x9448d40a76b5170877ea49f3c2d400baf4a71d7b3f05c415a01e392b82fbdb2b';
const DEFAULT_CHAIN_ID = '56'; // BSC
const REBALANCE_JOBS_BASE_URL =
  'https://beta-api.owlia.ai/api/v1/rebalance/jobs/address/0xC5dE8e48F7897b926e2c4D129Ba68af1df811229?network=bsc';
const REBALANCE_JOBS_PAGE_SIZE = 20;

async function main() {
  console.log('🚀 Starting Transaction Parser Test\n');

  const args = process.argv.slice(2);
  const flagArgs = new Set(args.filter(arg => arg.startsWith('--')));
  const positionalArgs = args.filter(arg => !arg.startsWith('--'));
  const runJobsTest =
    flagArgs.has('--jobs') || flagArgs.has('--rebalance') || flagArgs.has('--fetch-jobs');
  const runJobsOnly = runJobsTest && positionalArgs.length === 0 && !flagArgs.has('--with-tx');

  // Get transaction hash and chain ID from command line arguments
  const txHash = positionalArgs[0] || DEFAULT_TX_HASH;
  const chainId = positionalArgs[1] || DEFAULT_CHAIN_ID;

  if (runJobsOnly) {
    console.log('ℹ️ Running rebalance jobs timeline only (skipping direct transaction parsing).\n');
  } else {
    console.log(`📋 Transaction Details:`);
    console.log(`   Hash: ${txHash}`);
    console.log(`   Chain ID: ${chainId} (${getChainName(chainId)})`);
    console.log('');
  }

  // Create service instance
  console.log('🔧 Initializing TransactionParserService...');
  const parserService = new TransactionParserService();
  console.log('✓ Service initialized\n');

  try {
    if (!runJobsOnly) {
      console.log('='.repeat(80));
      console.log('Fetching and Parsing Transaction...');
      console.log('='.repeat(80));
      console.log('');

      // Parse the transaction
      const startTime = Date.now();
      const parsed = await parserService.parseTransaction(txHash, chainId);
      const elapsed = Date.now() - startTime;

      console.log(`✅ Transaction parsed successfully in ${elapsed}ms\n`);

      // Display summary
      console.log('='.repeat(80));
      console.log('Transaction Summary');
      console.log('='.repeat(80));
      console.log(`Transaction Hash: ${parsed.transactionHash}`);
      console.log(`Block Number: ${parsed.blockNumber}`);
      if (parsed.timestamp) {
        console.log(`Timestamp: ${new Date(parsed.timestamp * 1000).toISOString()}`);
      }
      console.log(`Total Logs: ${parsed.rawLogs?.length || 0}`);
      console.log(`Parsed Actions: ${parsed.actions.length}`);
      console.log('');

      // Display formatted actions
      console.log('='.repeat(80));
      console.log('Rebalance Actions');
      console.log('='.repeat(80));
      console.log('');

      if (parsed.actions.length === 0) {
        console.log('⚠️  No rebalance actions detected in this transaction');
        console.log('');
        console.log('This could mean:');
        console.log('  - The transaction does not contain any supported protocol events');
        console.log('  - The transaction uses protocols that are not yet supported');
        console.log('  - The event signatures do not match the expected formats');
        console.log('');
      } else {
        parsed.actions.forEach((action, idx) => {
          console.log(`┌─ Action #${idx + 1} ${'─'.repeat(70)}`);
          console.log(`│`);
          console.log(`│  Type: ${action.type}`);
          console.log(`│  Protocol: ${action.protocol}`);
          console.log(`│  Event Index: ${action.eventIndex}`);
          console.log(`│  Log Index: ${action.logIndex}`);
          console.log(`│`);
          console.log(`│  Tokens:`);

          action.tokens.forEach((token, tokenIdx) => {
            console.log(`│    [${tokenIdx + 1}] Address: ${token.token}`);
            console.log(`│        Amount: ${token.amount}`);
            if (token.symbol) {
              console.log(`│        Symbol: ${token.symbol}`);
            }
            if (token.decimals !== undefined) {
              console.log(`│        Decimals: ${token.decimals}`);
            }
            if (token.amountFormatted) {
              console.log(`│        Formatted: ${token.amountFormatted}`);
            }
            if (tokenIdx < action.tokens.length - 1) {
              console.log(`│`);
            }
          });

          if (action.metadata && Object.keys(action.metadata).length > 0) {
            console.log(`│`);
            console.log(`│  Metadata:`);
            Object.entries(action.metadata).forEach(([key, value]) => {
              console.log(`│    ${key}: ${JSON.stringify(value)}`);
            });
          }

          console.log(`│`);
          console.log(`└${'─'.repeat(79)}`);
          console.log('');
        });
      }

      // Display formatted output
      console.log('='.repeat(80));
      console.log('Formatted Output');
      console.log('='.repeat(80));
      console.log('');
      const formatted = parserService.formatParsedTransaction(parsed);
      console.log(formatted);
      console.log('');

      // Display position tracking
      console.log('='.repeat(80));
      console.log('Position Tracking');
      console.log('='.repeat(80));
      console.log('');
      const positionSummary = parserService.trackPositionFlows([{ txHash, parsed }], chainId);
      const positionFormatted = parserService.formatPositionTracking(positionSummary, chainId);
      console.log(positionFormatted);
      console.log('');

      // Display raw logs for debugging
      if (parsed.rawLogs && parsed.rawLogs.length > 0) {
        console.log('='.repeat(80));
        console.log('Raw Logs (for debugging)');
        console.log('='.repeat(80));
        console.log('');
        console.log(`Total logs: ${parsed.rawLogs.length}`);
        console.log('');

        parsed.rawLogs.slice(0, 5).forEach((log, idx) => {
          console.log(`Log #${idx}:`);
          console.log(`  Address: ${log.address}`);
          console.log(`  Topics: ${log.topics.join(', ')}`);
          console.log(`  Data: ${log.data.substring(0, 66)}${log.data.length > 66 ? '...' : ''}`);
          console.log('');
        });

        if (parsed.rawLogs.length > 5) {
          console.log(`... and ${parsed.rawLogs.length - 5} more logs`);
          console.log('');
        }
      }

      // Statistics
      console.log('='.repeat(80));
      console.log('Statistics');
      console.log('='.repeat(80));
      console.log('');

      const actionTypes = new Map<string, number>();
      const protocols = new Map<string, number>();

      parsed.actions.forEach(action => {
        actionTypes.set(action.type, (actionTypes.get(action.type) || 0) + 1);
        protocols.set(action.protocol, (protocols.get(action.protocol) || 0) + 1);
      });

      console.log('Action Types:');
      actionTypes.forEach((count, type) => {
        console.log(`  ${type}: ${count}`);
      });
      console.log('');

      console.log('Protocols:');
      protocols.forEach((count, protocol) => {
        console.log(`  ${protocol}: ${count}`);
      });
      console.log('');

      console.log('✅ Test completed successfully!');
      console.log('');
    }

    if (runJobsTest) {
      await runRebalanceJobsTest(parserService);
    } else {
      console.log('Tip: Run with --jobs to fetch and parse the latest rebalance events from the API.\n');
    }
  } catch (error) {
    console.error('\n❌ Error parsing transaction:', error);
    throw error;
  }
}

/**
 * Get chain name from chain ID
 */
function getChainName(chainId: string): string {
  const names: Record<string, string> = {
    '1': 'Ethereum',
    '56': 'BSC',
    '8453': 'Base',
    '42161': 'Arbitrum',
    '10': 'Optimism',
  };
  return names[chainId] || 'Unknown';
}

interface TargetEventSummary {
  txHash: string;
  protocol: Protocol;
  type: RebalanceActionType;
  timestamp?: number;
  blockNumber: number;
  logIndex: number;
  eventIndex: number;
  tokens: TokenAmount[];
  logAddress?: string;
  decodedArgs?: Record<string, any> | null;
  tokenId?: string; // For Uniswap V3 LP positions
}

async function runRebalanceJobsTest(parserService: TransactionParserService) {
  console.log('='.repeat(80));
  console.log('Rebalance Jobs Timeline');
  console.log('='.repeat(80));
  console.log('');

  const txHashes = await fetchTxHashesFromApi();
  if (txHashes.length === 0) {
    console.log('⚠️  No transaction hashes found in the latest rebalance jobs response.');
    console.log('    Check the API response format or try again later.\n');
    return;
  }

  const events: TargetEventSummary[] = [];
  const exportEvents: TargetEventSummary[] = [];
  const allParsedTransactions: Array<{ txHash: string; parsed: any }> = [];

  for (const txHash of txHashes) {
    console.log(`🔎 Parsing rebalance transaction: ${txHash}`);
    try {
      const parsed = await parserService.parseTransaction(txHash, DEFAULT_CHAIN_ID);
      allParsedTransactions.push({ txHash, parsed });

      // First pass: collect actions and infer tokenIds for POOL events
      const actionsWithInferredTokenId = parsed.actions.map((action, i) => {
        let inferredTokenId: string | undefined;

        // Infer tokenId for POOL_BURN from next REMOVE_LIQUIDITY
        if (action.protocol === Protocol.UNISWAP_V3 && action.type === RebalanceActionType.POOL_BURN) {
          for (let j = i + 1; j < parsed.actions.length; j++) {
            const nextAction = parsed.actions[j];
            if (
              nextAction.protocol === Protocol.UNISWAP_V3 &&
              nextAction.type === RebalanceActionType.REMOVE_LIQUIDITY &&
              nextAction.tokenId
            ) {
              inferredTokenId = nextAction.tokenId;
              break;
            }
          }
        }

        // Infer tokenId for POOL_COLLECT from nearby REMOVE_LIQUIDITY
        if (action.protocol === Protocol.UNISWAP_V3 && action.type === RebalanceActionType.POOL_COLLECT) {
          // Try backward first
          for (let j = i - 1; j >= 0; j--) {
            const prevAction = parsed.actions[j];
            if (
              prevAction.protocol === Protocol.UNISWAP_V3 &&
              prevAction.type === RebalanceActionType.REMOVE_LIQUIDITY &&
              prevAction.tokenId
            ) {
              inferredTokenId = prevAction.tokenId;
              break;
            }
          }
          // If not found, try forward
          if (!inferredTokenId) {
            for (let j = i + 1; j < parsed.actions.length; j++) {
              const nextAction = parsed.actions[j];
              if (
                nextAction.protocol === Protocol.UNISWAP_V3 &&
                nextAction.type === RebalanceActionType.REMOVE_LIQUIDITY &&
                nextAction.tokenId
              ) {
                inferredTokenId = nextAction.tokenId;
                break;
              }
            }
          }
        }

        // Infer tokenId for POOL_MINT from next ADD_LIQUIDITY
        if (action.protocol === Protocol.UNISWAP_V3 && action.type === RebalanceActionType.POOL_MINT) {
          for (let j = i + 1; j < parsed.actions.length; j++) {
            const nextAction = parsed.actions[j];
            if (
              nextAction.protocol === Protocol.UNISWAP_V3 &&
              nextAction.type === RebalanceActionType.ADD_LIQUIDITY &&
              nextAction.tokenId
            ) {
              inferredTokenId = nextAction.tokenId;
              break;
            }
          }
        }

        return { action, inferredTokenId };
      });

      // Second pass: create summaries with inferred tokenIds
      actionsWithInferredTokenId.forEach(({ action, inferredTokenId }) => {
        const rawLog = parsed.rawLogs?.find(log => log.index === action.logIndex);
        const summary: TargetEventSummary = {
          txHash: parsed.transactionHash,
          protocol: action.protocol,
          type: action.type,
          timestamp: parsed.timestamp,
          blockNumber: parsed.blockNumber,
          logIndex: action.logIndex,
          eventIndex: action.eventIndex,
          tokens: action.tokens,
          logAddress: rawLog?.address,
          decodedArgs: decodeEventArgs(action.protocol, action.type, rawLog),
          tokenId: action.tokenId || inferredTokenId, // Use explicit tokenId or inferred tokenId
        };

        if (isExportAction(action.protocol, action.type)) {
          exportEvents.push(summary);
        }

        if (isTimelineAction(action.protocol, action.type)) {
          events.push(summary);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`⚠️  Failed to parse ${txHash}: ${message}`);
    }
  }

  if (events.length === 0) {
    console.log('\n⚠️  No matching rebalance events detected among the fetched transactions.\n');
    return;
  }

  events.sort((a, b) => {
    if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) {
      return a.timestamp - b.timestamp;
    }
    if (a.timestamp && !b.timestamp) return -1;
    if (!a.timestamp && b.timestamp) return 1;
    if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
    if (a.logIndex !== b.logIndex) return a.logIndex - b.logIndex;
    return a.eventIndex - b.eventIndex;
  });

  const groupedByTx = new Map<string, TargetEventSummary[]>();
  events.forEach(event => {
    if (!groupedByTx.has(event.txHash)) {
      groupedByTx.set(event.txHash, []);
    }
    groupedByTx.get(event.txHash)!.push(event);
  });

  console.log('');
  console.log(`🗓️  Timeline (${events.length} events)`);
  console.log('');

  groupedByTx.forEach((txEvents, txHash) => {
    txEvents.sort((a, b) => a.logIndex - b.logIndex || a.eventIndex - b.eventIndex);

    const timestampLabel = txEvents[0]?.timestamp
      ? new Date(txEvents[0].timestamp! * 1000).toISOString()
      : 'unknown';

    const eventsText = txEvents
      .map(event => {
        const actionLabel = `${event.protocol} ${event.type}`;
        const tokensText = event.tokens
          .map(token => {
            const amountDisplay = formatAmountDisplay(token);
            const symbolDisplay = formatTokenLabel(token);
            return `${amountDisplay} ${symbolDisplay}`;
          })
          .join(', ');
        return `${actionLabel}: ${tokensText}`;
      })
      .join(' | ');

    console.log(`${timestampLabel} | tx ${txHash} | ${eventsText}`);
  });

  console.log('✅ Rebalance jobs timeline generated.\n');

  // Display position tracking for all transactions
  console.log('='.repeat(80));
  console.log('LP Position Tracking Summary (All Transactions)');
  console.log('='.repeat(80));
  console.log('');

  // Track LP positions across all transactions
  const positionSummary = parserService.trackPositionFlows(allParsedTransactions, DEFAULT_CHAIN_ID);
  const positionFormatted = parserService.formatPositionTracking(positionSummary, DEFAULT_CHAIN_ID);
  console.log(positionFormatted);

  if (positionSummary.positions.size === 0) {
    console.log('ℹ️  No LP positions with tokenId found in the analyzed transactions.');
  } else {
    console.log(
      `\n✅ Tracked ${positionSummary.positions.size} unique LP position(s) across ${allParsedTransactions.length} transaction(s).\n`,
    );
  }

  // Display lending position tracking
  console.log('='.repeat(80));
  console.log('Lending Position Tracking Summary (All Transactions)');
  console.log('='.repeat(80));
  console.log('');

  // Track lending positions across all transactions
  const lendingSummary = parserService.trackLendingPositions(allParsedTransactions, DEFAULT_CHAIN_ID);
  const lendingFormatted = parserService.formatLendingPositions(lendingSummary, DEFAULT_CHAIN_ID);
  console.log(lendingFormatted);

  if (lendingSummary.positions.size === 0) {
    console.log('ℹ️  No lending positions found in the analyzed transactions.');
  } else {
    console.log(
      `\n✅ Tracked ${lendingSummary.positions.size} lending position(s) across ${allParsedTransactions.length} transaction(s).\n`,
    );
  }

  const exportPayload = buildExportPayload(exportEvents);
  writeJsonExport(exportPayload);
}

async function fetchTxHashesFromApi(): Promise<string[]> {
  const seen = new Set<string>();
  const hashes: string[] = [];
  const pagesToFetch = 2; // Fetch first 2 pages

  for (let page = 1; page <= pagesToFetch; page++) {
    const url = `${REBALANCE_JOBS_BASE_URL}&page=${page}&pageSize=${REBALANCE_JOBS_PAGE_SIZE}`;
    console.log(`🌐 Fetching rebalance jobs from page ${page}...`);

    try {
      const response = await axios.get(url, { timeout: 15000 });
      const items = extractItems(response.data);

      let pageHashes = 0;
      items.forEach(item => {
        const hash = extractTxHash(item);
        if (hash && !seen.has(hash)) {
          seen.add(hash);
          hashes.push(hash);
          pageHashes++;
        }
      });

      console.log(`✓ Page ${page}: Retrieved ${pageHashes} unique transaction hash(es)`);

      // If we got fewer items than page size, no more pages to fetch
      if (items.length < REBALANCE_JOBS_PAGE_SIZE) {
        console.log(`ℹ️  No more pages available after page ${page}`);
        break;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to fetch page ${page}: ${message}`);
      // Continue to next page even if one fails
    }
  }

  console.log(`✓ Total: Retrieved ${hashes.length} unique transaction hash(es) from ${pagesToFetch} page(s)\n`);
  return hashes;
}

function extractItems(data: any): any[] {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data.data)) return data.data;
  if (data.data && Array.isArray(data.data.items)) return data.data.items;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function extractTxHash(record: any): string | null {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const candidates = [
    'txHash',
    'tx_hash',
    'transactionHash',
    'transaction_hash',
    'txId',
    'txid',
    'transactionId',
    'transaction_id',
  ];

  for (const key of candidates) {
    const value = record[key];
    if (typeof value === 'string' && value.startsWith('0x')) {
      return value;
    }
  }

  if (record.txInfo) {
    const nested = extractTxHash(record.txInfo);
    if (nested) return nested;
  }

  if (record.metadata) {
    const nested = extractTxHash(record.metadata);
    if (nested) return nested;
  }

  if (Array.isArray(record.steps)) {
    for (const step of record.steps) {
      const nested = extractTxHash(step);
      if (nested) return nested;
    }
  }

  if (Array.isArray(record.transactions)) {
    for (const tx of record.transactions) {
      const nested = extractTxHash(tx);
      if (nested) return nested;
    }
  }

  if (record.job && typeof record.job === 'object') {
    const nested = extractTxHash(record.job);
    if (nested) return nested;
  }

  return null;
}

function isTimelineAction(protocol: Protocol, actionType: RebalanceActionType): boolean {
  if (protocol === Protocol.AAVE) {
    return (
      actionType === RebalanceActionType.SUPPLY || actionType === RebalanceActionType.WITHDRAW
    );
  }

  if (protocol === Protocol.EULER) {
    return (
      actionType === RebalanceActionType.SUPPLY || actionType === RebalanceActionType.WITHDRAW
    );
  }

  if (protocol === Protocol.UNISWAP_V3) {
    return (
      actionType === RebalanceActionType.POOL_MINT ||
      actionType === RebalanceActionType.POOL_COLLECT
    );
  }

  if (protocol === Protocol.OKX_ROUTER) {
    return actionType === RebalanceActionType.SWAP;
  }

  return false;
}

function isExportAction(protocol: Protocol, actionType: RebalanceActionType): boolean {
  if (protocol === Protocol.AAVE || protocol === Protocol.EULER) {
    return (
      actionType === RebalanceActionType.SUPPLY || actionType === RebalanceActionType.WITHDRAW
    );
  }

  if (protocol === Protocol.UNISWAP_V3) {
    return (
      actionType === RebalanceActionType.POOL_MINT ||
      actionType === RebalanceActionType.POOL_COLLECT ||
      actionType === RebalanceActionType.POOL_BURN ||
      actionType === RebalanceActionType.ADD_LIQUIDITY ||
      actionType === RebalanceActionType.REMOVE_LIQUIDITY
    );
  }

  if (protocol === Protocol.OKX_ROUTER) {
    return actionType === RebalanceActionType.SWAP;
  }

  return false;
}

function formatAmountDisplay(token: TokenAmount, precision = 2): string {
  let raw =
    token.amountFormatted ??
    (token.decimals !== undefined
      ? safeFormatUnits(token.amount, token.decimals)
      : token.amount);

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric.toFixed(precision);
  }

  const parsed = parseFloat(raw);
  if (Number.isFinite(parsed)) {
    return parsed.toFixed(precision);
  }

  return raw;
}

function safeFormatUnits(amount: string, decimals: number): string {
  try {
    return ethers.formatUnits(amount, decimals);
  } catch {
    return amount;
  }
}

function formatTokenLabel(token: TokenAmount): string {
  if (token.symbol) {
    return token.symbol;
  }
  if (token.token && token.token.length > 10) {
    return `${token.token.slice(0, 6)}...${token.token.slice(-4)}`;
  }
  return token.token || 'UNKNOWN';
}

type EventDecoderKey = `${Protocol}:${RebalanceActionType}`;

const EVENT_DECODERS: Partial<Record<EventDecoderKey, { name: string; abi: any }>> = {
  [`${Protocol.AAVE}:${RebalanceActionType.SUPPLY}`]: {
    name: 'Supply',
    abi: {
      anonymous: false,
      inputs: [
        { indexed: true, name: 'reserve', type: 'address' },
        { indexed: false, name: 'user', type: 'address' },
        { indexed: true, name: 'onBehalfOf', type: 'address' },
        { indexed: false, name: 'amount', type: 'uint256' },
        { indexed: true, name: 'referralCode', type: 'uint16' },
      ],
      name: 'Supply',
      type: 'event',
    },
  },
  [`${Protocol.AAVE}:${RebalanceActionType.WITHDRAW}`]: {
    name: 'Withdraw',
    abi: {
      anonymous: false,
      inputs: [
        { indexed: true, name: 'reserve', type: 'address' },
        { indexed: true, name: 'user', type: 'address' },
        { indexed: true, name: 'to', type: 'address' },
        { indexed: false, name: 'amount', type: 'uint256' },
      ],
      name: 'Withdraw',
      type: 'event',
    },
  },
  [`${Protocol.AAVE}:${RebalanceActionType.BORROW}`]: {
    name: 'Borrow',
    abi: {
      anonymous: false,
      inputs: [
        { indexed: true, name: 'reserve', type: 'address' },
        { indexed: false, name: 'user', type: 'address' },
        { indexed: true, name: 'onBehalfOf', type: 'address' },
        { indexed: false, name: 'amount', type: 'uint256' },
        { indexed: false, name: 'borrowRateMode', type: 'uint256' },
        { indexed: false, name: 'borrowRate', type: 'uint256' },
        { indexed: true, name: 'referralCode', type: 'uint16' },
      ],
      name: 'Borrow',
      type: 'event',
    },
  },
  [`${Protocol.AAVE}:${RebalanceActionType.REPAY}`]: {
    name: 'Repay',
    abi: {
      anonymous: false,
      inputs: [
        { indexed: true, name: 'reserve', type: 'address' },
        { indexed: true, name: 'user', type: 'address' },
        { indexed: true, name: 'repayer', type: 'address' },
        { indexed: false, name: 'amount', type: 'uint256' },
        { indexed: false, name: 'useATokens', type: 'bool' },
      ],
      name: 'Repay',
      type: 'event',
    },
  },
  [`${Protocol.EULER}:${RebalanceActionType.SUPPLY}`]: {
    name: 'Deposit',
    abi: {
      anonymous: false,
      inputs: [
        { indexed: true, name: 'sender', type: 'address' },
        { indexed: true, name: 'owner', type: 'address' },
        { indexed: false, name: 'assets', type: 'uint256' },
        { indexed: false, name: 'shares', type: 'uint256' },
      ],
      name: 'Deposit',
      type: 'event',
    },
  },
  [`${Protocol.EULER}:${RebalanceActionType.WITHDRAW}`]: {
    name: 'Withdraw',
    abi: {
      anonymous: false,
      inputs: [
        { indexed: true, name: 'sender', type: 'address' },
        { indexed: true, name: 'receiver', type: 'address' },
        { indexed: true, name: 'owner', type: 'address' },
        { indexed: false, name: 'assets', type: 'uint256' },
        { indexed: false, name: 'shares', type: 'uint256' },
      ],
      name: 'Withdraw',
      type: 'event',
    },
  },
  [`${Protocol.UNISWAP_V3}:${RebalanceActionType.POOL_MINT}`]: {
    name: 'Mint',
    abi: {
      anonymous: false,
      inputs: [
        { indexed: false, name: 'sender', type: 'address' },
        { indexed: true, name: 'owner', type: 'address' },
        { indexed: true, name: 'tickLower', type: 'int24' },
        { indexed: true, name: 'tickUpper', type: 'int24' },
        { indexed: false, name: 'amount', type: 'uint128' },
        { indexed: false, name: 'amount0', type: 'uint256' },
        { indexed: false, name: 'amount1', type: 'uint256' },
      ],
      name: 'Mint',
      type: 'event',
    },
  },
  [`${Protocol.UNISWAP_V3}:${RebalanceActionType.POOL_BURN}`]: {
    name: 'Burn',
    abi: {
      anonymous: false,
      inputs: [
        { indexed: true, name: 'owner', type: 'address' },
        { indexed: true, name: 'tickLower', type: 'int24' },
        { indexed: true, name: 'tickUpper', type: 'int24' },
        { indexed: false, name: 'amount', type: 'uint128' },
        { indexed: false, name: 'amount0', type: 'uint256' },
        { indexed: false, name: 'amount1', type: 'uint256' },
      ],
      name: 'Burn',
      type: 'event',
    },
  },
  [`${Protocol.UNISWAP_V3}:${RebalanceActionType.POOL_COLLECT}`]: {
    name: 'Collect',
    abi: {
      anonymous: false,
      inputs: [
        { indexed: true, name: 'owner', type: 'address' },
        { indexed: false, name: 'recipient', type: 'address' },
        { indexed: true, name: 'tickLower', type: 'int24' },
        { indexed: true, name: 'tickUpper', type: 'int24' },
        { indexed: false, name: 'amount0', type: 'uint128' },
        { indexed: false, name: 'amount1', type: 'uint128' },
      ],
      name: 'Collect',
      type: 'event',
    },
  },
  [`${Protocol.OKX_ROUTER}:${RebalanceActionType.SWAP}`]: {
    name: 'OrderRecord',
    abi: {
      anonymous: false,
      inputs: [
        { indexed: false, name: 'fromToken', type: 'address' },
        { indexed: false, name: 'toToken', type: 'address' },
        { indexed: false, name: 'sender', type: 'address' },
        { indexed: false, name: 'fromAmount', type: 'uint256' },
        { indexed: false, name: 'returnAmount', type: 'uint256' },
      ],
      name: 'OrderRecord',
      type: 'event',
    },
  },
};

function decodeEventArgs(
  protocol: Protocol,
  actionType: RebalanceActionType,
  rawLog?: { topics: string[]; data: string },
): Record<string, any> | null {
  if (!rawLog) return null;
  const key = `${protocol}:${actionType}` as EventDecoderKey;
  const def = EVENT_DECODERS[key];
  if (!def) return null;

  try {
    const iface = new ethers.Interface([def.abi]);
    const parsed = iface.parseLog({ topics: rawLog.topics, data: rawLog.data });

    const decoded: Record<string, any> = {};
    def.abi.inputs.forEach((input: any, idx: number) => {
      const name = input.name || String(idx);
      const value = parsed.args[idx];
      if (typeof value === 'bigint') {
        decoded[name] = value.toString();
      } else if (value && typeof value === 'object' && 'toString' in value) {
        decoded[name] = value.toString();
      } else {
        decoded[name] = value;
      }
    });

    return decoded;
  } catch {
    return null;
  }
}

function buildExportPayload(events: TargetEventSummary[]) {
  const account = extractAccountFromUrl(REBALANCE_JOBS_BASE_URL) ?? 'unknown';
  if (events.length === 0) {
    return { account, results: [] };
  }

  const sortedEvents = [...events].sort((a, b) => {
    if (a.timestamp && b.timestamp && a.timestamp !== b.timestamp) {
      return b.timestamp - a.timestamp;
    }
    if (a.timestamp && !b.timestamp) return -1;
    if (!a.timestamp && b.timestamp) return 1;
    if (a.blockNumber !== b.blockNumber) return b.blockNumber - a.blockNumber;
    if (a.logIndex !== b.logIndex) return b.logIndex - a.logIndex;
    return b.eventIndex - a.eventIndex;
  });

  const grouped = new Map<string, TargetEventSummary[]>();
  sortedEvents.forEach(event => {
    if (!grouped.has(event.txHash)) {
      grouped.set(event.txHash, []);
    }
    grouped.get(event.txHash)!.push(event);
  });

  const results = Array.from(grouped.entries())
    .map(([txHash, txEvents]) => {
      const orderedEvents = txEvents.sort(
        (a, b) => a.logIndex - b.logIndex || a.eventIndex - b.eventIndex,
      );
      const mapped = orderedEvents
        .map(event => mapEventToExport(event))
        .filter((item): item is Record<string, any> => Boolean(item));

      if (mapped.length === 0) {
        return null;
      }

      const time = orderedEvents[0]?.timestamp
        ? new Date(orderedEvents[0].timestamp! * 1000).toISOString()
        : null;

      return {
        txHash,
        time,
        results: mapped,
      };
    })
    .filter((entry): entry is { txHash: string; time: string | null; results: any[] } => Boolean(entry));

  return { account, results };
}

function extractAccountFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('address');
  } catch {
    return null;
  }
}

function mapEventToExport(event: TargetEventSummary): Record<string, any> | null {
  const [tokenA, tokenB] = event.tokens;
  switch (event.protocol) {
    case Protocol.AAVE: {
      const base = {
        poolAddress: event.logAddress,
        token: tokenA?.token,
        tokenSymbol: tokenA?.symbol,
        user: event.decodedArgs?.user ?? event.decodedArgs?.['1'] ?? null,
        amount: tokenA ? formatAmountDisplay(tokenA, 2) : null,
      };

      if (event.type === RebalanceActionType.SUPPLY) {
        return { type: 'aave_supply', ...base };
      }
      if (event.type === RebalanceActionType.WITHDRAW) {
        return { type: 'aave_withdraw', ...base };
      }
      return null;
    }
    case Protocol.EULER: {
      const base = {
        vaultAddress: event.logAddress,
        token: tokenA?.token,
        tokenSymbol: tokenA?.symbol,
        owner: event.decodedArgs?.owner ?? event.decodedArgs?.['1'] ?? null,
        amount: tokenA ? formatAmountDisplay(tokenA, 2) : null,
      };

      if (event.type === RebalanceActionType.SUPPLY) {
        return { type: 'euler_supply', ...base };
      }
      if (event.type === RebalanceActionType.WITHDRAW) {
        return { type: 'euler_withdraw', ...base };
      }
      return null;
    }
    case Protocol.UNISWAP_V3: {
      const base = {
        poolAddress: event.logAddress,
        tokenId: event.tokenId ?? event.decodedArgs?.tokenId ?? null, // Use tokenId from action first
        token0: tokenA?.token,
        token0Symbol: tokenA?.symbol,
        amount0: tokenA ? formatAmountDisplay(tokenA, 2) : null,
        token1: tokenB?.token,
        token1Symbol: tokenB?.symbol,
        amount1: tokenB ? formatAmountDisplay(tokenB, 2) : null,
      };

      if (event.type === RebalanceActionType.POOL_MINT) {
        return { type: 'mint', ...base };
      }
      if (event.type === RebalanceActionType.POOL_COLLECT) {
        return { type: 'collect', ...base };
      }
      if (event.type === RebalanceActionType.POOL_BURN) {
        return { type: 'burn', ...base };
      }
      if (event.type === RebalanceActionType.ADD_LIQUIDITY) {
        return { type: 'add_liquidity', ...base };
      }
      if (event.type === RebalanceActionType.REMOVE_LIQUIDITY) {
        return { type: 'remove_liquidity', ...base };
      }
      return null;
    }
    case Protocol.OKX_ROUTER: {
      if (event.type !== RebalanceActionType.SWAP) {
        return null;
      }

      const fromToken = tokenA;
      const toToken = tokenB;

      return {
        type: 'swap',
        fromToken: fromToken?.token,
        fromTokenSymbol: fromToken?.symbol,
        toToken: toToken?.token,
        toTokenSymbol: toToken?.symbol,
        fromAmount: fromToken ? formatAmountDisplay(fromToken, 2) : null,
        returnAmount: toToken ? formatAmountDisplay(toToken, 2) : null,
      };
    }
    default:
      return null;
  }
}

function writeJsonExport(payload: any) {
  try {
    if (!fs.existsSync('exports')) {
      fs.mkdirSync('exports', { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = `exports/rebalance-timeline-${timestamp}.json`;
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');

    console.log(`📄 JSON export saved to ${filePath}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Failed to write JSON export: ${message}`);
  }
}

main().catch(error => {
  console.error('\n\n❌ Test failed:', error);
  console.error(error.stack);
  process.exit(1);
});
