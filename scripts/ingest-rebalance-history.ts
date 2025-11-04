#!/usr/bin/env ts-node

/**
 * Historical rebalance ingestion script.
 *
 * Scans rebalance log files, finds executed jobs, parses confirmed transactions,
 * and persists them into rebalance_execution_snapshots.
 *
 * Usage examples:
 *   npx ts-node scripts/ingest-rebalance-history.ts --date=2025-10-30 --dry-run
 *   npx ts-node scripts/ingest-rebalance-history.ts --since=2025-10-30 --until=2025-10-31
 *   npx ts-node scripts/ingest-rebalance-history.ts --limit=5
 */

import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';

loadEnv();

import * as fs from 'fs';
import * as path from 'path';
import { DataSource, Repository } from 'typeorm';
import AppDataSource from '../ormconfig';
import { RebalanceJob } from '../src/entities/rebalance-job.entity';
import { RebalanceExecutionSnapshot } from '../src/entities/rebalance-execution-snapshot.entity';
import { TransactionParserService } from '../src/monitor/transaction-parser.service';
import { User } from '../src/entities/user.entity';

type JsonRecord = Record<string, any>;

interface ScriptOptions {
  dates: string[];
  since?: string;
  until?: string;
  dryRun: boolean;
  limit?: number;
  verbose: boolean;
}

interface IngestionContext {
  dataSource: DataSource;
  jobRepo: Repository<RebalanceJob>;
  snapshotRepo: Repository<RebalanceExecutionSnapshot>;
  userRepo: Repository<User>;
  parser: TransactionParserService;
  options: ScriptOptions;
  userCache: Map<string, User>;
}

interface IngestionResult {
  processed: number;
  inserted: number;
  skipped: number;
  errors: number;
}

interface YieldSummaryLookup {
  summary: JsonRecord;
  source: string;
}

const LOG_BASE_DIR = path.resolve(process.cwd(), 'logs/rebalance');

async function main() {
  const options = parseArgs();

  if (!fs.existsSync(LOG_BASE_DIR)) {
    console.error(`❌ Log directory not found: ${LOG_BASE_DIR}`);
    process.exit(1);
  }

  const dateDirs = resolveDateDirectories(options);
  if (dateDirs.length === 0) {
    console.log('ℹ️  No matching date directories found.');
    return;
  }

  const logFiles = collectJsonLogFiles(dateDirs);
  if (logFiles.length === 0) {
    console.log('ℹ️  No JSON rebalance logs found for selected dates.');
    return;
  }

  const limitedFiles = options.limit ? logFiles.slice(0, options.limit) : logFiles;
  console.log(`🔍 Found ${logFiles.length} JSON log(s); processing ${limitedFiles.length}.`);

  let dataSource: DataSource | null = null;
  const context: IngestionContext = {
    dataSource: null as unknown as DataSource,
    jobRepo: null as unknown as Repository<RebalanceJob>,
    snapshotRepo: null as unknown as Repository<RebalanceExecutionSnapshot>,
    userRepo: null as unknown as Repository<User>,
    parser: new TransactionParserService(),
    options,
    userCache: new Map<string, User>(),
  };

  try {
    dataSource = await AppDataSource.initialize();
    context.dataSource = dataSource;
    context.jobRepo = dataSource.getRepository(RebalanceJob);
    context.snapshotRepo = dataSource.getRepository(RebalanceExecutionSnapshot);
    context.userRepo = dataSource.getRepository(User);

    const results: IngestionResult = {
      processed: 0,
      inserted: 0,
      skipped: 0,
      errors: 0,
    };

    for (const file of limitedFiles) {
      const relativePath = path.relative(process.cwd(), file);
      results.processed += 1;

      try {
        const logData = await readJsonFile(file);
        const jobIdentifier = extractJobId(logData);

        if (!jobIdentifier) {
          results.skipped += 1;
          console.warn(`⚠️  ${relativePath}: Unable to determine job id, skipping.`);
          continue;
        }

        const txHash = extractTransactionHash(logData);
        if (!txHash) {
          results.skipped += 1;
          console.warn(`⚠️  ${relativePath}: No transaction hash found, skipping.`);
          continue;
        }

        const job = await context.jobRepo.findOne({ where: { id: jobIdentifier } });
        if (!job) {
          results.skipped += 1;
          console.warn(`⚠️  ${relativePath}: Job ${jobIdentifier} not found in database, skipping.`);
          continue;
        }

        const existing = await context.snapshotRepo.findOne({
          where: [{ jobId: jobIdentifier }, { txHash }],
        });
        if (existing) {
          results.skipped += 1;
          if (options.verbose) {
            console.log(`➡️  ${relativePath}: Snapshot already exists (job ${jobIdentifier}).`);
          }
          continue;
        }

        const chainId = await determineChainId(logData, job, context);
        if (!chainId) {
          results.skipped += 1;
          console.warn(`⚠️  ${relativePath}: Unable to determine chain id, skipping.`);
          continue;
        }

        const parsedTx = await context.parser.parseTransaction(txHash, chainId);
        const { rawLogs: _rawLogsIgnored, ...parsedTxWithoutRawLogs } = parsedTx;
        const txTime = parsedTx.timestamp ? new Date(parsedTx.timestamp * 1000) : new Date();

        const metadataSummary = extractAccountYieldSummaryFromMetadata(logData);
        const logSummary = extractAccountYieldSummaryFromLogFile(file);
        const finalSummary = metadataSummary ?? logSummary;
        const accountYieldSummary = finalSummary?.summary ?? null;

        logYieldSummaryStatus(
          relativePath,
          metadataSummary,
          logSummary,
          finalSummary,
          context.options,
        );

        const snapshot = context.snapshotRepo.create({
          userId: job.userId,
          jobId: job.id,
          txHash,
          txTime,
          accountYieldSummary: accountYieldSummary ?? null,
          parsedTransaction: parsedTxWithoutRawLogs,
        });

        if (options.dryRun) {
          results.skipped += 1;
          console.log(
            `🧪 (dry-run) Would insert snapshot for job ${job.id} | tx ${txHash} | user ${job.userId}`,
          );
        } else {
          await context.snapshotRepo.save(snapshot);
          results.inserted += 1;
          console.log(
            `✅ Inserted snapshot for job ${job.id} | tx ${txHash} | user ${job.userId}`,
          );
        }
      } catch (error) {
        results.errors += 1;
        console.error(`❌ ${relativePath}: ${error instanceof Error ? error.message : error}`);
      }
    }

    console.log('\n📊 Ingestion summary');
    console.log('-------------------');
    console.log(`Processed: ${results.processed}`);
    console.log(`Inserted:  ${results.inserted}`);
    console.log(`Skipped:   ${results.skipped}`);
    console.log(`Errors:    ${results.errors}`);
  } catch (error) {
    console.error('❌ Fatal error during ingestion:', error);
    process.exitCode = 1;
  } finally {
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

function parseArgs(): ScriptOptions {
  const args = process.argv.slice(2);
  const options: ScriptOptions = {
    dates: [],
    dryRun: false,
    verbose: false,
  };

  for (const arg of args) {
    if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg.startsWith('--date=')) {
      const value = arg.split('=')[1];
      options.dates = value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--since=')) {
      options.since = arg.split('=')[1];
    } else if (arg.startsWith('--until=')) {
      options.until = arg.split('=')[1];
    } else if (arg.startsWith('--limit=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (!Number.isNaN(parsed)) {
        options.limit = parsed;
      }
    } else {
      console.warn(`⚠️  Unknown argument ignored: ${arg}`);
    }
  }

  return options;
}

function resolveDateDirectories(options: ScriptOptions): string[] {
  const entries = fs
    .readdirSync(LOG_BASE_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory());

  const allDates = entries
    .map(entry => entry.name)
    .filter(name => /^\d{4}-\d{2}-\d{2}/.test(name))
    .sort();

  if (allDates.length === 0) {
    return [];
  }

  let selected: string[] = [];

  if (options.dates.length > 0) {
    selected = allDates.filter(date => options.dates.includes(date));
  } else if (options.since || options.until) {
    selected = allDates.filter(date => {
      if (options.since && date < options.since) {
        return false;
      }
      if (options.until && date > options.until) {
        return false;
      }
      return true;
    });
  } else {
    selected = allDates.slice(-2);
  }

  if (selected.length === 0 && options.dates.length > 0) {
    console.warn(`⚠️  None of the requested dates were found under ${LOG_BASE_DIR}.`);
  }

  return selected.map(date => path.join(LOG_BASE_DIR, date));
}

function collectJsonLogFiles(dateDirs: string[]): string[] {
  const jsonFiles: string[] = [];

  for (const dir of dateDirs) {
    collectJsonFilesRecursive(dir, jsonFiles);
  }

  jsonFiles.sort();
  return jsonFiles;
}

function collectJsonFilesRecursive(dir: string, acc: string[]) {
  if (!fs.existsSync(dir)) {
    return;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectJsonFilesRecursive(fullPath, acc);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      acc.push(fullPath);
    }
  }
}

async function readJsonFile(filePath: string): Promise<JsonRecord> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  return JSON.parse(content) as JsonRecord;
}

function extractJobId(logData: JsonRecord): string | null {
  const metadata = logData.metadata ?? {};
  const payload = metadata.payload ?? {};

  if (typeof payload.jobId === 'string') {
    return payload.jobId;
  }

  const idempotencyKey: string | undefined = payload.idempotencyKey;
  if (idempotencyKey) {
    const match = idempotencyKey.match(/rebalance_([0-9a-fA-F-]{36})_/);
    if (match) {
      return match[1];
    }
  }

  if (typeof metadata.jobId === 'string') {
    return metadata.jobId;
  }

  // Fallback: sometimes tx result may include job id
  const mcpResult = metadata.mcpResult ?? {};
  if (typeof mcpResult.jobId === 'string') {
    return mcpResult.jobId;
  }

  return null;
}

function extractTransactionHash(logData: JsonRecord): string | null {
  const metadata = logData.metadata ?? {};
  const mcpResult = metadata.mcpResult ?? {};

  if (typeof mcpResult.txHash === 'string') {
    return mcpResult.txHash;
  }

  if (Array.isArray(mcpResult.txHashes) && mcpResult.txHashes.length > 0) {
    const first = mcpResult.txHashes.find((hash: unknown) => typeof hash === 'string');
    if (first) {
      return first;
    }
  }

  const logs = Array.isArray(logData.logs) ? logData.logs : [];
  for (const entry of logs) {
    if (!entry || typeof entry.message !== 'string') {
      continue;
    }
    const message: string = entry.message;
    const match = message.match(/transaction (?:submitted|hash)[:\s]+(0x[0-9a-fA-F]+)/);
    if (match) {
      return match[1];
    }
    const matchTxHash = message.match(/txHash[:\s]+(0x[0-9a-fA-F]+)/);
    if (matchTxHash) {
      return matchTxHash[1];
    }
  }

  return null;
}

async function determineChainId(
  logData: JsonRecord,
  job: RebalanceJob,
  context: IngestionContext,
): Promise<string | null> {
  const metadata = logData.metadata ?? {};
  const payload = metadata.payload ?? {};

  if (payload.chainId) {
    return String(payload.chainId);
  }

  if (logData.chainId) {
    return String(logData.chainId);
  }

  const user = await loadUser(job.userId, context);
  if (user?.chainId) {
    return String(user.chainId);
  }

  return null;
}

function extractAccountYieldSummaryFromMetadata(logData: JsonRecord): YieldSummaryLookup | null {
  const metadata = logData.metadata ?? {};
  const direct = metadata.accountYieldSummary;
  if (direct && typeof direct === 'object') {
    return { summary: direct, source: 'metadata.accountYieldSummary' };
  }

  const precheck = metadata.precheckResult?.yieldSummary;
  if (precheck && typeof precheck === 'object') {
    return { summary: precheck, source: 'metadata.precheckResult.yieldSummary' };
  }

  const logsArray = Array.isArray(logData.logs) ? logData.logs : [];
  const fromLogs = extractYieldSummaryFromLogEntries(logsArray);
  if (fromLogs) {
    return fromLogs;
  }

  return null;
}

async function loadUser(userId: string, context: IngestionContext): Promise<User | null> {
  if (context.userCache.has(userId)) {
    return context.userCache.get(userId) ?? null;
  }

  const user = await context.userRepo.findOne({ where: { id: userId } });
  if (user) {
    context.userCache.set(userId, user);
  }
  return user;
}

function extractAccountYieldSummaryFromLogFile(jsonPath: string): YieldSummaryLookup | null {
  const textPath = jsonPath.replace(/\.json$/, '.log');
  if (!fs.existsSync(textPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(textPath, 'utf-8');
    const lines = content.split(/\r?\n/);
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const markerIndex = line.indexOf('yieldSummary=');
      if (markerIndex === -1) {
        continue;
      }
      let buffer = line.slice(markerIndex + 'yieldSummary='.length).trim();
      if (!buffer) {
        continue;
      }

      let offset = lineIndex + 1;
      let jsonString = extractJsonObjectFromString(buffer);

      while (!jsonString && offset < lines.length) {
        buffer += '\n' + lines[offset];
        jsonString = extractJsonObjectFromString(buffer);
        offset += 1;
      }

      if (!jsonString) {
        continue;
      }

      try {
        const parsed = JSON.parse(jsonString);
        if (parsed && typeof parsed === 'object') {
          return {
            summary: parsed,
            source: `log:${path.basename(textPath)}#L${lineIndex + 1}`,
          };
        }
      } catch (error) {
        console.warn(
          `⚠️  Failed to parse yieldSummary JSON from ${textPath} (line ${lineIndex + 1}): ${
            (error as Error).message
          }`,
        );
      }
    }
  } catch (error) {
    console.warn(`⚠️  Failed to read text log ${textPath}: ${(error as Error).message}`);
  }

  return null;
}

function extractYieldSummaryFromLogEntries(logs: any[]): YieldSummaryLookup | null {
  for (let index = 0; index < logs.length; index += 1) {
    const entry = logs[index];
    const message = entry?.message;
    if (typeof message !== 'string') {
      continue;
    }

    const markerIndex = message.indexOf('yieldSummary=');
    if (markerIndex === -1) {
      continue;
    }

    const raw = message.slice(markerIndex + 'yieldSummary='.length).trim();
    const jsonString = extractJsonObjectFromString(raw);
    if (!jsonString) {
      continue;
    }

    try {
      const parsed = JSON.parse(jsonString);
      if (parsed && typeof parsed === 'object') {
        const ts = entry?.timestamp ? `@${entry.timestamp}` : '';
        return {
          summary: parsed,
          source: `logs[${index}].message${ts}`,
        };
      }
    } catch (error) {
      console.warn(
        `⚠️  Failed to parse yieldSummary JSON from logs[${index}].message: ${
          (error as Error).message
        }`,
      );
    }
  }

  return null;
}

function extractJsonObjectFromString(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i += 1) {
    const char = raw[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          return raw.slice(start, i + 1);
        }
      }
    }
  }

  return null;
}

function logYieldSummaryStatus(
  relativePath: string,
  metadataSummary: YieldSummaryLookup | null,
  logSummary: YieldSummaryLookup | null,
  finalSummary: YieldSummaryLookup | null,
  options: ScriptOptions,
) {
  const metaStatus = metadataSummary ? `found (${metadataSummary.source})` : 'missing';
  const logStatus = logSummary ? `found (${logSummary.source})` : 'missing';

  if (finalSummary) {
    const baseMessage = `[yieldSummary] ${relativePath}: found via ${finalSummary.source} (metadata=${metaStatus}, log=${logStatus})`;
    if (options.verbose) {
      const keys = Object.keys(finalSummary.summary || {});
      const preview = keys.slice(0, 5).join(', ') || '(no keys)';
      console.log(`${baseMessage} | keys: ${preview}`);
    } else {
      console.log(baseMessage);
    }
  } else {
    console.warn(
      `[yieldSummary] ${relativePath}: NOT FOUND (metadata=${metaStatus}, log=${logStatus})`,
    );
  }
}

main().catch(error => {
  console.error('❌ Unhandled error during ingestion:', error);
  process.exit(1);
});
