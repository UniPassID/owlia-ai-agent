import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPolicy } from '../entities/user-policy.entity';
import { User } from '../entities/user.entity';
import { RebalanceJob, JobStatus } from '../entities/rebalance-job.entity';
import { RebalanceQueueService } from '../queue/rebalance-queue.service';
import {
  RebalancePrecheckService,
  RebalancePrecheckResult,
  StrategyPosition,
} from './rebalance-precheck.service';
import { UserService } from '../api/user.service';
import { AgentService } from '../agent/agent.service';
import { lookupTokenAddress } from '../agent/token-utils';
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
    private queueService: RebalanceQueueService,
    private precheckService: RebalancePrecheckService,
    private userService: UserService,
    private agentService: AgentService,
  ) {

    setTimeout(() => {
      this.monitorAllUsers()
    }, 30 * 1000)
  }

  /**
   * Scheduled task to monitor all users with auto-enabled
   */
  // @Cron(CronExpression.EVERY_5_MINUTES)
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

    // Trigger rebalance check - let agent decide
    try {
      const precheck = await this.precheckService.evaluate(user, policy);
      if (!precheck.shouldTrigger) {
        this.logger.log(
          `Skipped rebalance for user ${user.id}: portfolio APY ${precheck.portfolioApy.toFixed(2)}% ` +
          `vs opportunity APY ${precheck.opportunityApy.toFixed(2)}% (diff ${precheck.differenceBps.toFixed(2)} bps) ret: ${JSON.stringify(precheck)}`,);
        return; 
      } 
      // Trigger rebalance with precheck result
      await this.triggerRebalance(user, policy, 'scheduled_monitor', precheck);
    } catch (error) {
      this.logger.error(
        `Failed to check/trigger rebalance for user ${user.id}: ${error.message}`,
      );
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

    try {
      // Execute rebalance directly
      await this.executeRebalance(user, precheckResult, job);

      job.status = JobStatus.COMPLETED;
      await this.jobRepo.save(job);
      this.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      job.status = JobStatus.FAILED;
      job.errorMessage = error.message;
      await this.jobRepo.save(job);
      this.logger.error(`Job ${job.id} failed: ${error.message}`);
      throw error;
    }

    return job;
  }

  private async executeRebalance(
    user: User,
    precheckResult: RebalancePrecheckResult,
    job: RebalanceJob,
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
        this.logger.log(`Processing supply position: ${JSON.stringify(position)}`);

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
        this.logger.log(`Processing LP position: ${JSON.stringify(position)}`);

        const lpPosition = this.extractLpPosition(position, chainId);

        this.logger.log(`Extracted LP position: ${JSON.stringify(lpPosition)}`);

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
      `Calling rebalance_position with ${targetLendingSupplyPositions.length} supply positions ` +
      `and ${targetLiquidityPositions.length} LP positions: ${JSON.stringify(payload)}`,
    );


    const rebalanceResult = await this.agentService.callMcpTool<any>('rebalance_position', payload);

    // Extract transaction hash
    const txHash = rebalanceResult?.txHash ||
                   rebalanceResult?.transactionHash ||
                   this.extractTxHash(JSON.stringify(rebalanceResult));

    if (txHash) {
      this.logger.log(`Rebalance transaction submitted: ${txHash}`);
      job.execResult = {
        txHash,
        result: rebalanceResult,
        timestamp: new Date().toISOString(),
      };
      await this.jobRepo.save(job);
    } else {
      throw new Error('No transaction hash returned from rebalance_position');
    }
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

  private extractTxHash(output: string): string | null {
    const match = output.match(/0x[a-fA-F0-9]{64}/);
    return match ? match[0] : null;
  }

}
