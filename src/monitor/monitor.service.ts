import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPolicy } from '../entities/user-policy.entity';
import { User } from '../entities/user.entity';
import { RebalanceJob, JobStatus } from '../entities/rebalance-job.entity';
import {
  RebalancePrecheckService,
  RebalancePrecheckResult,
  StrategyPosition,
} from './rebalance-precheck.service';
import { RebalanceSummaryService } from './rebalance-summary.service';
import { UserService } from '../api/user.service';
import { AgentService } from '../agent/agent.service';
import { lookupTokenAddress } from '../agent/token-utils';
import { extractTxHashFromOutput, verifyTransactionOnChain } from '../utils/chain-verifier.util';
import { RebalanceLoggerService } from '../utils/rebalance-logger.service';
import type {
  ProtocolType,
  AccountYieldSummaryResponse,
  AccountLendingPosition,
  AccountLendingProtocolPosition,
  AccountLendingSupply,
} from '../agent/types/mcp.types';

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);
  private monitoringInProgress = false;

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(UserPolicy)
    private userPolicyRepo: Repository<UserPolicy>,
    @InjectRepository(RebalanceJob)
    private jobRepo: Repository<RebalanceJob>,
    private precheckService: RebalancePrecheckService,
    private rebalanceSummaryService: RebalanceSummaryService,
    private userService: UserService,
    private agentService: AgentService,
    private rebalanceLogger: RebalanceLoggerService,
  ) {

    setTimeout(() => {
      this.monitorAllUsers()
    }, 30 * 1000)
  }

  /**
   * Scheduled task to monitor all users with auto-enabled
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async monitorAllUsers() {
    if (this.monitoringInProgress) {
      this.logger.warn('Skipping scheduled monitoring - previous run still in progress');
      return;
    }

    this.monitoringInProgress = true;
    this.logger.log('Starting scheduled monitoring...');

    try {
      const users = await this.userRepo.find();
      this.logger.log(`Found ${users.length} users to monitor`);

      for (const user of users) {
        try {
          const policy = await this.userPolicyRepo.findOne({ where: { userId: user.id } });
          await this.checkUserPositions(user, policy);
        } catch (error) {
          this.logger.error(
            `Failed to monitor user ${user.id}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Monitoring task failed: ${error.message}`);
    } finally {
      this.monitoringInProgress = false;
    }
  }

  /**
   * Check a specific user's positions and trigger rebalance if needed
   * Agent will analyze positions and determine if rebalancing is beneficial
   */
  async checkUserPositions(user: User, policy: UserPolicy | null): Promise<void> {
    this.logger.log(`Checking positions for user ${user.id}`);

    // Generate a temporary session ID for logging
    const sessionId = `check_${user.id}_${Date.now()}`;

    // Start log capture
    this.rebalanceLogger.startCapture(sessionId, {
      userId: user.id,
      userAddress: user.address,
      chainId: user.chainId?.toString(),
      trigger: 'scheduled_monitor',
    });

    // Start global log interception to capture nested function logs
    this.rebalanceLogger.startInterception(sessionId);

    try {
      this.logger.log(`Checking positions for user ${user.id}`);
      this.logger.log('Starting precheck evaluation...');

      const precheck = await this.precheckService.evaluate(user, policy);

      // Log precheck results (these will also be captured by interception)
      this.logger.log(`Precheck completed: shouldTrigger=${precheck.shouldTrigger}`);
      this.logger.log(`Portfolio APY: ${precheck.portfolioApy.toFixed(2)}%`);
      this.logger.log(`Opportunity APY: ${precheck.opportunityApy.toFixed(2)}%`);
      this.logger.log(`Difference: ${precheck.differenceBps.toFixed(2)} bps`);

      if (!precheck.shouldTrigger) {
        this.logger.log(
          `Skipped rebalance: portfolio APY ${precheck.portfolioApy.toFixed(2)}% ` +
          `vs opportunity APY ${precheck.opportunityApy.toFixed(2)}% (diff ${precheck.differenceBps.toFixed(2)} bps)`,
        );
        this.logger.log('Rebalance not triggered - conditions not met');
        // Don't save log file for skipped rebalances
        return;
      }

      this.logger.log('Proceeding with rebalance...');
      if (precheck.bestStrategy) {
        this.logger.log(`Selected strategy: ${precheck.bestStrategy.name}`);
      }

      // Update metadata with precheck result
      this.rebalanceLogger.updateMetadata(sessionId, {
        precheckResult: {
          shouldTrigger: precheck.shouldTrigger,
          portfolioApy: precheck.portfolioApy,
          opportunityApy: precheck.opportunityApy,
          differenceBps: precheck.differenceBps,
          totalPortfolioValueUsd: precheck.totalPortfolioValueUsd,
          gasEstimate: precheck.gasEstimate,
          breakEvenTimeHours: precheck.breakEvenTimeHours,
          netGainUsd: precheck.netGainUsd,
          bestStrategy: precheck.bestStrategy,
        },
      });

      // Trigger rebalance with precheck result
      await this.triggerRebalance(user, policy, 'scheduled_monitor', precheck, sessionId);
    } catch (error) {
      this.logger.error(
        `Failed to check/trigger rebalance for user ${user.id}: ${error.message}`,
      );
      // Save log even on error if evaluation was attempted
      await this.rebalanceLogger.saveToFile(sessionId, 'FAILED');
    } finally {
      // Always stop interception
      this.rebalanceLogger.stopInterception();
    }
  }

  async evaluateUserPrecheckByAddress(address: string, chainId: string) {
    const user = await this.userService.getUserByAddress(address, chainId);
    if (!user) {
      throw new NotFoundException(`User with address ${address} not found`);
    }

    const policy = await this.userPolicyRepo.findOne({ where: { userId: user.id } });
    return this.precheckService.evaluate(user, policy);
  }

  /**
   * Trigger a rebalance job for a user - directly execute rebalance
   */
  async triggerRebalance(
    user: User,
    policy: UserPolicy | null,
    trigger: string,
    precheckResult: RebalancePrecheckResult,
    sessionId?: string,
  ): Promise<RebalanceJob> {
    const latestJob = await this.jobRepo.findOne({
      where: { userId: user.id },
      order: { createdAt: 'DESC' },
    });

    if (latestJob) {
      const jobAgeMs = Date.now() - new Date(latestJob.createdAt).getTime();
      const tenMinutesMs = 10 * 60 * 1000;
      const oneMinuteMs = 1 * 60 * 1000;

      // For PENDING or SIMULATING jobs, wait 10 minutes before creating new job
      if (
        (latestJob.status === JobStatus.PENDING || latestJob.status === JobStatus.SIMULATING) &&
        jobAgeMs <= tenMinutesMs
      ) {
        this.logger.log(
          `Skipping new job for user ${user.id}: recent job ${latestJob.id} in status ${latestJob.status} (age ${Math.round(jobAgeMs / 1000)}s)`,
        );
        return latestJob;
      }

      if (latestJob.status === JobStatus.COMPLETED &&
        jobAgeMs <= oneMinuteMs * 30)
       {
        this.logger.log(
          `Skipping new job for user ${user.id}: recent ${latestJob.status} job ${latestJob.id} (age ${Math.round(jobAgeMs / 1000)}s, minimum 60s)`,
        );
        return latestJob;
      }


      // For FAILED or COMPLETED jobs, only wait 1 minute before allowing retry
      if (
        (latestJob.status === JobStatus.FAILED || latestJob.status === JobStatus.COMPLETED) &&
        jobAgeMs <= oneMinuteMs
      ) {
        this.logger.log(
          `Skipping new job for user ${user.id}: recent ${latestJob.status} job ${latestJob.id} (age ${Math.round(jobAgeMs / 1000)}s, minimum 60s)`,
        );
        return latestJob;
      }
    }

    // Find the selected strategy's evaluation record
    const selectedEvaluationRecord = precheckResult.strategyEvaluations?.find(
      record => record.isSelected
    );

    // Create job record
    const job = this.jobRepo.create({
      userId: user.id,
      trigger,
      status: JobStatus.PENDING,
      inputContext: {
        precheckResult: {
          shouldTrigger: precheckResult.shouldTrigger,
          portfolioApy: precheckResult.portfolioApy,
          opportunityApy: precheckResult.opportunityApy,
          differenceBps: precheckResult.differenceBps,
          totalPortfolioValueUsd: precheckResult.totalPortfolioValueUsd,
          gasEstimate: precheckResult.gasEstimate,
          breakEvenTimeHours: precheckResult.breakEvenTimeHours,
          netGainUsd: precheckResult.netGainUsd,
          bestStrategy: precheckResult.bestStrategy,
        },
        selectedStrategyEvaluation: selectedEvaluationRecord,
        // allStrategyEvaluations: precheckResult.strategyEvaluations,
      },
    });
    await this.jobRepo.save(job);

    this.logger.log(`Created rebalance job ${job.id} for user ${user.id}`);

    // Use existing session or create new one
    const logSessionId = sessionId || `job_${job.id}`;

    // If no sessionId provided (e.g., manual trigger), start new capture and interception
    if (!sessionId) {
      this.rebalanceLogger.startCapture(logSessionId, {
        userId: user.id,
        userAddress: user.address,
        chainId: user.chainId?.toString(),
        trigger,
        precheckResult: job.inputContext.precheckResult,
      });
      this.rebalanceLogger.startInterception(logSessionId);
    }

    try {
      // Execute rebalance directly (logs will be auto-captured)
      await this.executeRebalance(user, precheckResult, job, logSessionId);

      job.status = JobStatus.COMPLETED;
      this.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      job.status = JobStatus.FAILED;
      job.errorMessage = error.message;
      this.logger.error(`Job ${job.id} failed: ${error.message}`);
    } finally {
      // Save logs to file (only if triggered by shouldTrigger=true)
      const savedPaths = await this.rebalanceLogger.saveToFile(logSessionId, job.status);

      // Generate execResult from log content
      if (savedPaths.textPath) {
        try {
          const logContent = await this.rebalanceLogger.readLogFile(savedPaths.textPath);
          if (logContent) {
            const execResult = await this.rebalanceSummaryService.generateExecResult(logContent);
            if (execResult) {
              job.execResult = execResult;
              this.logger.log(`Generated execResult for job ${job.id}`);
            } else {
              this.logger.warn(`Failed to generate execResult for job ${job.id}`);
            }
          }
        } catch (error) {
          this.logger.error(`Error generating execResult for job ${job.id}: ${error.message}`);
          // Don't throw - we don't want execResult generation failure to break the flow
        }
      }

      await this.jobRepo.save(job);

      // Stop interception if we started it
      if (!sessionId) {
        this.rebalanceLogger.stopInterception();
      }

      if (job.status === JobStatus.FAILED && job.errorMessage) {
        throw new Error(job.errorMessage);
      }
    }

    return job;
  }

  private async executeRebalance(
    user: User,
    precheckResult: RebalancePrecheckResult,
    job: RebalanceJob,
    sessionId: string,
  ): Promise<void> {
    if (!precheckResult.bestStrategy) {
      throw new Error('No strategy available for rebalance');
    }

    const chainId = user.chainId.toString();
    const safeAddress = user.address;
    const strategy = precheckResult.bestStrategy.strategy;

    this.logger.log(
      `Executing rebalance for job ${job.id}: ${precheckResult.bestStrategy.name}`,
    );

    // Process both supply and LP positions
    const targetLendingSupplyPositions = [];
    const targetLiquidityPositions = [];

    for (const position of strategy.positions) {
      if (position.type === 'supply') {
        this.logger.log(`Processing supply position: ${position.asset} on ${position.protocol}`);

        const tokenAddress = this.extractSupplyTokenAddress(position, chainId);
        const vTokenAddress = this.extractSupplyVTokenAddress(
          position,
          chainId,
          precheckResult.yieldSummary,
        );

        this.logger.log(`Extracted tokenAddress: ${tokenAddress}, vTokenAddress: ${vTokenAddress}`);

        targetLendingSupplyPositions.push({
          protocol: this.normalizeProtocolType(position.protocol),
          token: tokenAddress,
          vToken: vTokenAddress,
          amount: position.amount.toString(),
        });
      } else if (position.type === 'lp') {
        this.logger.log(`Processing LP position on ${position.protocol}`);

        const lpPosition = this.extractLpPosition(position, chainId);

        this.logger.log(`Extracted LP position, pool: ${lpPosition.poolAddress}`);

        targetLiquidityPositions.push(lpPosition);
      }
    }

    if (targetLendingSupplyPositions.length === 0 && targetLiquidityPositions.length === 0) {
      throw new Error('No valid positions to rebalance');
    }

    const payload = {
      safeAddress,
      walletAddress: safeAddress,
      chainId,
      idempotencyKey: `rebalance_${job.id}_${Date.now()}`,
      targetLendingSupplyPositions,
      targetLiquidityPositions,
    };

    this.logger.log(
      `Calling rebalance_position with ${targetLendingSupplyPositions.length} supply + ${targetLiquidityPositions.length} LP positions`,
    );

    // Store payload in metadata for log file
    this.rebalanceLogger.updateMetadata(sessionId, { payload });

    const rebalanceResult = await this.agentService.callMcpTool<any>('rebalance_position', payload);

    this.logger.log(`Rebalance MCP tool returned successfully`);

    // Store result in metadata
    this.rebalanceLogger.updateMetadata(sessionId, { mcpResult: rebalanceResult });

    // Extract transaction hash
    const txHash = rebalanceResult?.txHash ||
                   rebalanceResult?.transactionHash ||
                   extractTxHashFromOutput(JSON.stringify(rebalanceResult));

    if (!txHash) {
      throw new Error('No transaction hash returned from rebalance_position');
    }

    this.logger.log(`Rebalance transaction submitted: ${txHash}`);

    // Verify transaction on chain
    this.logger.log(`Verifying transaction ${txHash} on chain ${chainId}`);

    const verification = await verifyTransactionOnChain(txHash, chainId);

    if (verification.success && verification.confirmed) {
      this.logger.log(`Transaction ${txHash} confirmed successfully at block ${verification.blockNumber}`);

      job.simulateReport= {
        txHash,
        transactionHash: txHash,
        blockNumber: verification.blockNumber,
        status: 'confirmed',
        result: rebalanceResult,
        timestamp: new Date().toISOString(),
      };
      await this.jobRepo.save(job);
      return;
    }

    if (verification.success && !verification.confirmed) {
      const errorMsg = `Transaction ${txHash} failed on chain: ${verification.error || 'Transaction not confirmed'}`;
      this.logger.error(errorMsg);

      job.simulateReport= {
        txHash,
        transactionHash: txHash,
        status: verification.status || 'failed',
        reason: verification.error || 'Transaction not confirmed',
        result: rebalanceResult,
        timestamp: new Date().toISOString(),
      };
      await this.jobRepo.save(job);
      throw new Error(errorMsg);
    }

    // Verification call failed
    const errorMsg = `Failed to verify transaction ${txHash}: ${verification.error}`;
    this.logger.error(errorMsg);
    throw new Error(errorMsg);
  }

  private extractSupplyTokenAddress(position: StrategyPosition, chainId: string): string {
    const extended = position as StrategyPosition & {
      poolInfo?: {
        tokenAddress?: string;
        token?: { address?: string };
        underlyingToken?: { address?: string };
      };
    };

    const poolTokenAddress =
      extended.poolInfo?.tokenAddress ||
      extended.poolInfo?.token?.address ||
      extended.poolInfo?.underlyingToken?.address;

    if (typeof poolTokenAddress === 'string' && poolTokenAddress.startsWith('0x')) {
      return poolTokenAddress;
    }

    const asset = position.asset;
    if (asset && asset.startsWith('0x')) {
      return asset;
    }

    if (asset) {
      const resolved = lookupTokenAddress(asset, chainId);
      if (resolved) {
        return resolved;
      }
    }

    throw new Error(`Unable to determine token address for supply position ${asset ?? 'unknown'}`);
  }

  private extractSupplyVTokenAddress(
    position: StrategyPosition,
    chainId: string,
    yieldSummary?: AccountYieldSummaryResponse,
  ): string | null {
    this.logger.log(`Checking vaultAddress from position: ${position.vaultAddress}`);

    // First check if vaultAddress is directly available in the position
    if (position.vaultAddress) {
      this.logger.log(`Found vToken from position.vaultAddress: ${position.vaultAddress}`);
      return position.vaultAddress;
    }

    // Try to get from poolInfo (for backward compatibility)
    const extended = position as StrategyPosition & {
      poolInfo?: {
        vTokenAddress?: string | null;
        vToken?: { address?: string | null };
        poolTokenAddress?: string | null;
      };
    };

    this.logger.log(`Checking poolInfo for vToken: ${JSON.stringify(extended.poolInfo)}`);

    const directVToken =
      extended.poolInfo?.vTokenAddress ||
      extended.poolInfo?.vToken?.address ||
      extended.poolInfo?.poolTokenAddress;

    if (directVToken) {
      this.logger.log(`Found direct vToken from poolInfo: ${directVToken}`);
      return directVToken;
    }

    // Last resort: lookup from yieldSummary
    this.logger.log(`No direct vToken found, trying to lookup from yieldSummary`);
    const result = this.lookupVTokenFromYieldSummary(position, chainId, yieldSummary);
    this.logger.log(`Lookup result: ${result}`);
    return result;
  }

  private lookupVTokenFromYieldSummary(
    position: StrategyPosition,
    chainId: string,
    yieldSummary?: AccountYieldSummaryResponse,
  ): string | null {
    const lendingSummary = yieldSummary?.activeInvestments?.lendingInvestments;
    if (!lendingSummary?.positions?.length) {
      return null;
    }

    const normalizedProtocol = this.normalizeProtocolType(position.protocol);
    const asset = (position.asset || '').trim();
    const isAssetAddress = asset.startsWith('0x');
    const assetSymbolUpper = asset.toUpperCase();
    const assetAddress =
      isAssetAddress
        ? asset.toLowerCase()
        : lookupTokenAddress(asset, chainId)?.toLowerCase() ?? null;

    const lendingPositions = lendingSummary.positions as AccountLendingPosition[];

    for (const lendingPosition of lendingPositions) {
      const lendingProtocol = this.normalizeProtocolType(lendingPosition.protocol);
      if (lendingProtocol !== normalizedProtocol) {
        continue;
      }

      const protocolPositions = this.toArray<AccountLendingProtocolPosition>(
        lendingPosition.protocolPositions,
      );

      for (const protocolPosition of protocolPositions) {
        const supplies = this.toArray<AccountLendingSupply>(protocolPosition?.supplies);
        for (const supply of supplies) {
          const supplySymbolUpper = supply.tokenSymbol?.toUpperCase?.() ?? '';
          const supplyAddressLower = supply.tokenAddress?.toLowerCase?.() ?? '';
          const symbolMatches =
            !isAssetAddress && assetSymbolUpper && supplySymbolUpper === assetSymbolUpper;
          const addressMatches = assetAddress && supplyAddressLower === assetAddress;

          if (!symbolMatches && !addressMatches) {
            continue;
          }

          const poolInfo = (supply as any)?.poolInfo;
          const candidate =
            supply.vTokenAddress ||
            poolInfo?.vTokenAddress ||
            poolInfo?.poolTokenAddress ||
            poolInfo?.vToken?.address ||
            null;

          if (candidate) {
            return candidate;
          }
        }
      }
    }

    return null;
  }

  private toArray<T>(value: T | T[] | undefined | null): T[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (value === undefined || value === null) {
      return [];
    }
    return [value];
  }

  private extractLpPosition(position: StrategyPosition, chainId: string): any {
    if (!position.poolAddress) {
      throw new Error('LP position missing poolAddress');
    }

    // Extract LP position data from strategy position
    const extended = position as StrategyPosition & {
      token0Address?: string;
      token1Address?: string;
      token0Amount?: number;
      token1Amount?: number;
      tickLower?: number;
      tickUpper?: number;
      poolInfo?: {
        token0Address?: string;
        token1Address?: string;
        token0Amount?: number;
        token1Amount?: number;
        tickLower?: number;
        tickUpper?: number;
      };
    };

    const token0Address = extended.token0Address || extended.poolInfo?.token0Address;
    const token1Address = extended.token1Address || extended.poolInfo?.token1Address;
    const token0Amount = extended.token0Amount || extended.poolInfo?.token0Amount;
    const token1Amount = extended.token1Amount || extended.poolInfo?.token1Amount;
    const tickLower = extended.tickLower ?? extended.poolInfo?.tickLower;
    const tickUpper = extended.tickUpper ?? extended.poolInfo?.tickUpper;

    if (!token0Address || !token1Address) {
      throw new Error(`LP position ${position.poolAddress} missing token addresses`);
    }

    if (token0Amount === undefined || token1Amount === undefined) {
      throw new Error(`LP position ${position.poolAddress} missing token amounts`);
    }

    if (tickLower === undefined || tickUpper === undefined) {
      throw new Error(`LP position ${position.poolAddress} missing tick range`);
    }

    const allocationRatio = position.allocation ? position.allocation / 100 : 1;

    return {
      protocol: this.normalizeLpProtocol(position.protocol),
      poolAddress: position.poolAddress,
      token0Address,
      token1Address,
      targetTickLower: tickLower,
      targetTickUpper: tickUpper,
      targetAmount0: (token0Amount * allocationRatio).toString(),
      targetAmount1: (token1Amount * allocationRatio).toString(),
    };
  }

  private normalizeProtocolType(protocol: string): ProtocolType {
    const normalized = protocol?.toLowerCase?.() ?? '';
    if (normalized.includes('aave')) return 'aave';
    if (normalized.includes('euler')) return 'euler';
    if (normalized.includes('venus')) return 'venus';
    throw new Error(`Unsupported lending protocol "${protocol}"`);
  }

  private normalizeLpProtocol(protocol: string | undefined): 'uniswapV3' | 'aerodromeSlipstream' {
    if (!protocol) throw new Error('LP protocol required');
    const normalized = protocol.toLowerCase();
    if (normalized.includes('uniswap')) return 'uniswapV3';
    if (normalized.includes('aerodrome')) return 'aerodromeSlipstream';
    throw new Error(`Invalid LP protocol: "${protocol}"`);
  }

}
