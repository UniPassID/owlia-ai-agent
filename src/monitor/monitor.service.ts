import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { In, Repository } from "typeorm";
import { User } from "../entities/user.entity";
import { RebalanceJob, JobStatus } from "../entities/rebalance-job.entity";
import { RebalanceExecutionSnapshot } from "../entities/rebalance-execution-snapshot.entity";
import {
  RebalancePrecheckService,
  RebalancePrecheckResult,
  StrategyPosition,
} from "./rebalance-precheck.service";
import { RebalanceSummaryService } from "./rebalance-summary.service";
import { AgentService } from "../agent/agent.service";
import { lookupTokenAddress } from "../agent/token-utils";
import {
  extractTxHashFromOutput,
  verifyTransactionOnChain,
} from "../utils/chain-verifier.util";
import { RebalanceLoggerService } from "../utils/rebalance-logger.service";
import { TransactionParserService } from "./transaction-parser.service";
import type {
  ProtocolType,
  AccountYieldSummaryResponse,
  AccountLendingPosition,
  AccountLendingProtocolPosition,
  AccountLendingSupply,
} from "../agent/types/mcp.types";
import {
  UserV2Deployment,
  UserV2DeploymentStatus,
} from "../entities/user-v2-deployment.entity";
import { getBytes, hexlify } from "ethers";
import { getChainId, getNetworkDto, NetworkDto } from "../user/dtos/user.dto";
import { UserService } from "../user/user.service";
import { UserV2 } from "../entities/user-v2.entity";
import { RPC_PROVIDERS } from "../config/rpc.config";

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);
  private monitoringInProgress = false;

  constructor(
    @InjectRepository(UserV2Deployment)
    private userDeploymentRepo: Repository<UserV2Deployment>,
    @InjectRepository(RebalanceJob)
    private jobRepo: Repository<RebalanceJob>,
    @InjectRepository(RebalanceExecutionSnapshot)
    private snapshotRepo: Repository<RebalanceExecutionSnapshot>,
    private precheckService: RebalancePrecheckService,
    private rebalanceSummaryService: RebalanceSummaryService,
    private agentService: AgentService,
    private transactionParser: TransactionParserService,
    private userService: UserService,
    @InjectRepository(UserV2)
    private userRepo: Repository<UserV2>,
    private rebalanceLogger: RebalanceLoggerService
  ) {
    setTimeout(() => {
      this.monitorAllUsers();
    }, 30 * 1000);
  }

  /**
   * Scheduled task to monitor all users with auto-enabled
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async monitorAllUsers() {
    if (this.monitoringInProgress) {
      this.logger.warn(
        "Skipping scheduled monitoring - previous run still in progress"
      );
      return;
    }

    this.monitoringInProgress = true;
    this.logger.log("Starting scheduled monitoring...");

    try {
      const deployments = await this.userDeploymentRepo.find({
        where: {
          status: In([
            UserV2DeploymentStatus.init,
            UserV2DeploymentStatus.setGuardSuccess,
          ]),
        },
      });
      const users = await this.userRepo.find({
        where: {
          id: In(deployments.map((deployment) => deployment.userId)),
        },
      });
      const userMap = new Map(users.map((user) => [user.id, user]));
      this.logger.log(`Found ${deployments.length} users to monitor`);

      for (const deployment of deployments) {
        try {
          await this.checkUserPositions(
            userMap.get(deployment.userId),
            deployment
          );
        } catch (error) {
          this.logger.error(
            `Failed to monitor deployment ${deployment.id}: ${error.message}`
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
  async checkUserPositions(
    user: UserV2,
    deployment: UserV2Deployment
  ): Promise<void> {
    this.logger.log(`Checking positions for deployment ${deployment.id}`);

    // Generate a temporary session ID for logging
    const sessionId = `check_${deployment.id}_${Date.now()}`;

    // Start log capture
    this.rebalanceLogger.startCapture(sessionId, {
      deploymentId: deployment.id,
      userAddress: hexlify(deployment.address),
      chainId: deployment.chainId.toString(),
      trigger: "scheduled_monitor",
    });

    // Start global log interception to capture nested function logs
    this.rebalanceLogger.startInterception(sessionId);

    try {
      this.logger.log(`Checking positions for deployment ${deployment.id}`);
      this.logger.log("Starting precheck evaluation...");

      const precheck = await this.precheckService.evaluate(deployment);

      // Log precheck results (these will also be captured by interception)
      this.logger.log(
        `Precheck completed: shouldTrigger=${precheck.shouldTrigger}`
      );
      this.logger.log(`Portfolio APY: ${precheck.portfolioApy.toFixed(2)}%`);
      this.logger.log(
        `Opportunity APY: ${precheck.opportunityApy.toFixed(2)}%`
      );
      this.logger.log(`Difference: ${precheck.differenceBps.toFixed(2)} bps`);

      if (!precheck.shouldTrigger) {
        this.logger.log(
          `Skipped rebalance: portfolio APY ${precheck.portfolioApy.toFixed(2)}% ` +
            `vs opportunity APY ${precheck.opportunityApy.toFixed(2)}% (diff ${precheck.differenceBps.toFixed(2)} bps)`
        );
        this.logger.log("Rebalance not triggered - conditions not met");
        // Don't save log file for skipped rebalances
        return;
      }

      this.logger.log("Proceeding with rebalance...");
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
      await this.triggerRebalance(
        user,
        deployment,
        "scheduled_monitor",
        precheck,
        sessionId
      );
    } catch (error) {
      this.logger.error(
        `Failed to check/trigger rebalance for user ${deployment.userId}: ${error.message}`
      );
      // Save log even on error if evaluation was attempted
      await this.rebalanceLogger.saveToFile(sessionId, "FAILED");
    } finally {
      // Always stop interception
      this.rebalanceLogger.stopInterception();
    }
  }

  async evaluateUserPrecheckByAddress(address: string, network: NetworkDto) {
    const deployment = await this.userService.getDeploymentByAddress(
      address,
      network
    );
    if (!deployment) {
      throw new NotFoundException("Deployment not found");
    }
    return this.evaluateUserPrecheckByDeployment(
      deployment as UserV2Deployment
    );
  }

  async evaluateUserPrecheckByDeployment(deployment: UserV2Deployment) {
    return this.precheckService.evaluate(deployment);
  }

  /**
   * Trigger a rebalance job for a user - directly execute rebalance
   */
  async triggerRebalance(
    user: UserV2,
    deployment: UserV2Deployment,
    trigger: string,
    precheckResult: RebalancePrecheckResult,
    sessionId?: string
  ): Promise<RebalanceJob> {
    const latestJob = await this.jobRepo.findOne({
      where: { deploymentId: deployment.id },
      order: { createdAt: "DESC" },
    });

    if (latestJob) {
      const jobAgeMs = Date.now() - new Date(latestJob.createdAt).getTime();
      const tenMinutesMs = 10 * 60 * 1000;
      const oneMinuteMs = 1 * 60 * 1000;

      // For PENDING or SIMULATING jobs, wait 10 minutes before creating new job
      if (
        (latestJob.status === JobStatus.PENDING ||
          latestJob.status === JobStatus.SIMULATING) &&
        jobAgeMs <= tenMinutesMs
      ) {
        this.logger.log(
          `Skipping new job for user ${deployment.userId}: recent job ${latestJob.id} in status ${latestJob.status} (age ${Math.round(jobAgeMs / 1000)}s)`
        );
        return latestJob;
      }

      if (
        latestJob.status === JobStatus.COMPLETED &&
        jobAgeMs <= oneMinuteMs * 30
      ) {
        this.logger.log(
          `Skipping new job for user ${deployment.userId}: recent ${latestJob.status} job ${latestJob.id} (age ${Math.round(jobAgeMs / 1000)}s, minimum 60s)`
        );
        return latestJob;
      }

      // For FAILED or COMPLETED jobs, only wait 1 minute before allowing retry
      if (
        (latestJob.status === JobStatus.FAILED ||
          latestJob.status === JobStatus.COMPLETED) &&
        jobAgeMs <= oneMinuteMs
      ) {
        this.logger.log(
          `Skipping new job for user ${deployment.userId}: recent ${latestJob.status} job ${latestJob.id} (age ${Math.round(jobAgeMs / 1000)}s, minimum 60s)`
        );
        return latestJob;
      }
    }

    // Find the selected strategy's evaluation record
    const selectedEvaluationRecord = precheckResult.strategyEvaluations?.find(
      (record) => record.isSelected
    );

    // Create job record
    const job = this.jobRepo.create({
      deploymentId: deployment.id,
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

    this.logger.log(
      `Created rebalance job ${job.id} for user ${deployment.userId}`
    );

    // Use existing session or create new one
    const logSessionId = sessionId || `job_${job.id}`;

    // If no sessionId provided (e.g., manual trigger), start new capture and interception
    if (!sessionId) {
      this.rebalanceLogger.startCapture(logSessionId, {
        deploymentId: deployment.id,
        userAddress: hexlify(deployment.address),
        chainId: deployment.chainId.toString(),
        trigger,
        precheckResult: job.inputContext.precheckResult,
      });
      this.rebalanceLogger.startInterception(logSessionId);
    }

    try {
      // Execute rebalance directly (logs will be auto-captured)
      await this.executeRebalance(
        user,
        deployment,
        precheckResult,
        job,
        logSessionId
      );

      job.status = JobStatus.COMPLETED;
      job.completedAt = new Date();
      this.logger.log(`Job ${job.id} completed successfully`);
    } catch (error) {
      job.status = JobStatus.FAILED;
      job.completedAt = new Date();
      job.errorMessage = error.message;
      this.logger.error(`Job ${job.id} failed: ${error.message}`);
    } finally {
      // Save logs to file (only if triggered by shouldTrigger=true)
      const savedPaths = await this.rebalanceLogger.saveToFile(
        logSessionId,
        job.status
      );

      // Generate execResult from log content
      if (savedPaths.textPath) {
        try {
          const logContent = await this.rebalanceLogger.readLogFile(
            savedPaths.textPath
          );
          if (logContent) {
            const execResult =
              await this.rebalanceSummaryService.generateExecResult(logContent);
            if (execResult) {
              // Add txHash to the last step's metadata
              if (
                job.simulateReport?.txHash &&
                execResult.steps &&
                execResult.steps.length > 0
              ) {
                const lastStep = execResult.steps[execResult.steps.length - 1];
                if (!lastStep.metadata) {
                  lastStep.metadata = {};
                }
                lastStep.metadata.txHash = job.simulateReport.txHash;
                this.logger.log(
                  `Added txHash ${job.simulateReport.txHash} to execResult`
                );
              }

              job.execResult = execResult;
              this.logger.log(`Generated execResult for job ${job.id}`);
            } else {
              this.logger.warn(
                `Failed to generate execResult for job ${job.id}`
              );
            }
          }
        } catch (error) {
          this.logger.error(
            `Error generating execResult for job ${job.id}: ${error.message}`
          );
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
    user: UserV2,
    deployment: UserV2Deployment,
    precheckResult: RebalancePrecheckResult,
    job: RebalanceJob,
    sessionId: string
  ): Promise<void> {
    if (!precheckResult.bestStrategy) {
      throw new Error("No strategy available for rebalance");
    }

    const chainId = deployment.chainId.toString();
    const safeAddress = hexlify(deployment.address);
    const strategy = precheckResult.bestStrategy.strategy;
    const network = getNetworkDto(deployment.chainId);
    const wallet = hexlify(user.wallet);
    let deployConfig;
    if (deployment.status === UserV2DeploymentStatus.init) {
      deployConfig = await this.userService.getWrappedDeploymentConfig(
        network,
        wallet
      );
    }

    this.logger.log(
      `Executing rebalance for job ${job.id}: ${precheckResult.bestStrategy.name}`
    );

    // Process both supply and LP positions
    const targetLendingSupplyPositions = [];
    const targetLiquidityPositions = [];

    for (const position of strategy.positions) {
      if (position.type === "supply") {
        this.logger.log(
          `Processing supply position: ${position.asset} on ${position.protocol}`
        );

        const tokenAddress = this.extractSupplyTokenAddress(position, chainId);
        const vTokenAddress = this.extractSupplyVTokenAddress(
          position,
          chainId,
          precheckResult.yieldSummary
        );

        this.logger.log(
          `Extracted tokenAddress: ${tokenAddress}, vTokenAddress: ${vTokenAddress}`
        );

        targetLendingSupplyPositions.push({
          protocol: this.normalizeProtocolType(position.protocol),
          token: tokenAddress,
          vToken: vTokenAddress,
          amount: position.amount.toString(),
        });
      } else if (position.type === "lp") {
        this.logger.log(`Processing LP position on ${position.protocol}`);

        const lpPosition = this.extractLpPosition(position, chainId);

        this.logger.log(
          `Extracted LP position, pool: ${lpPosition.poolAddress}`
        );

        targetLiquidityPositions.push(lpPosition);
      }
    }

    if (
      targetLendingSupplyPositions.length === 0 &&
      targetLiquidityPositions.length === 0
    ) {
      throw new Error("No valid positions to rebalance");
    }

    const payload = {
      safeAddress,
      walletAddress: wallet,
      operatorAddress: hexlify(deployment.operator),
      chainId,
      idempotencyKey: `rebalance_${job.id}_${Date.now()}`,
      targetLendingSupplyPositions,
      targetLiquidityPositions,
      deployConfig,
    };

    this.logger.log(
      `Calling rebalance_position with payload: ${JSON.stringify(payload)}`
    );

    // Store payload in metadata for log file
    this.rebalanceLogger.updateMetadata(sessionId, { payload });

    const rebalanceResult = await this.agentService.callMcpTool<any>(
      "rebalance_position",
      payload
    );

    this.logger.log(`Rebalance MCP tool returned successfully`);

    // Store result in metadata
    this.rebalanceLogger.updateMetadata(sessionId, {
      mcpResult: rebalanceResult,
    });

    // Extract transaction hash
    const txHash =
      rebalanceResult?.txHash ||
      rebalanceResult?.transactionHash ||
      extractTxHashFromOutput(JSON.stringify(rebalanceResult));

    if (!txHash) {
      throw new Error("No transaction hash returned from rebalance_position");
    }

    this.logger.log(`Rebalance transaction submitted: ${txHash}`);

    // Verify transaction on chain
    this.logger.log(`Verifying transaction ${txHash} on chain ${chainId}`);

    const verification = await verifyTransactionOnChain(txHash, chainId);

    if (verification.success && verification.confirmed) {
      this.logger.log(
        `Transaction ${txHash} confirmed successfully at block ${verification.blockNumber}`
      );
      if (
        deployment.status === UserV2DeploymentStatus.init &&
        (await RPC_PROVIDERS[chainId].getCode(safeAddress)) !== "0x"
      ) {
        deployment.status = UserV2DeploymentStatus.setGuardSuccess;
        await this.userDeploymentRepo.save(deployment);
        this.logger.log(
          `Deployment ${deployment.id} status updated to ${UserV2DeploymentStatus.setGuardSuccess}`
        );
      }

      job.simulateReport = {
        txHash,
        transactionHash: txHash,
        blockNumber: verification.blockNumber,
        status: "confirmed",
        result: rebalanceResult,
        timestamp: new Date().toISOString(),
      };
      await this.jobRepo.save(job);
      await this.saveRebalanceSnapshot(
        deployment,
        job,
        txHash,
        chainId,
        precheckResult
      );
      return;
    }

    if (verification.success && !verification.confirmed) {
      const errorMsg = `Transaction ${txHash} failed on chain: ${verification.error || "Transaction not confirmed"}`;
      this.logger.error(errorMsg);

      job.simulateReport = {
        txHash,
        transactionHash: txHash,
        status: verification.status || "failed",
        reason: verification.error || "Transaction not confirmed",
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

  private async saveRebalanceSnapshot(
    deployment: UserV2Deployment,
    job: RebalanceJob,
    txHash: string,
    chainId: string,
    precheckResult: RebalancePrecheckResult
  ): Promise<void> {
    const parsedTransaction = await this.transactionParser.parseTransaction(
      txHash,
      chainId
    );
    const { rawLogs: _rawLogsIgnored, ...parsedTransactionWithoutRawLogs } =
      parsedTransaction;
    const txTime =
      parsedTransaction.timestamp !== undefined
        ? new Date(parsedTransaction.timestamp * 1000)
        : new Date();

    const snapshot = this.snapshotRepo.create({
      deploymentId: deployment.id,
      jobId: job.id,
      txHash,
      txTime,
      accountYieldSummary: precheckResult.yieldSummary ?? null,
      parsedTransaction: parsedTransactionWithoutRawLogs,
    });

    await this.snapshotRepo.save(snapshot);
    this.logger.log(
      `Saved execution snapshot for job ${job.id} (tx ${txHash})`
    );
  }

  private extractSupplyTokenAddress(
    position: StrategyPosition,
    chainId: string
  ): string {
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

    if (
      typeof poolTokenAddress === "string" &&
      poolTokenAddress.startsWith("0x")
    ) {
      return poolTokenAddress;
    }

    const asset = position.asset;
    if (asset && asset.startsWith("0x")) {
      return asset;
    }

    if (asset) {
      const resolved = lookupTokenAddress(asset, chainId);
      if (resolved) {
        return resolved;
      }
    }

    throw new Error(
      `Unable to determine token address for supply position ${asset ?? "unknown"}`
    );
  }

  private extractSupplyVTokenAddress(
    position: StrategyPosition,
    chainId: string,
    yieldSummary?: AccountYieldSummaryResponse
  ): string | null {
    this.logger.log(
      `Checking vaultAddress from position: ${position.vaultAddress}`
    );

    // First check if vaultAddress is directly available in the position
    if (position.vaultAddress) {
      this.logger.log(
        `Found vToken from position.vaultAddress: ${position.vaultAddress}`
      );
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

    this.logger.log(
      `Checking poolInfo for vToken: ${JSON.stringify(extended.poolInfo)}`
    );

    const directVToken =
      extended.poolInfo?.vTokenAddress ||
      extended.poolInfo?.vToken?.address ||
      extended.poolInfo?.poolTokenAddress;

    if (directVToken) {
      this.logger.log(`Found direct vToken from poolInfo: ${directVToken}`);
      return directVToken;
    }

    // Last resort: lookup from yieldSummary
    this.logger.log(
      `No direct vToken found, trying to lookup from yieldSummary`
    );
    const result = this.lookupVTokenFromYieldSummary(
      position,
      chainId,
      yieldSummary
    );
    this.logger.log(`Lookup result: ${result}`);
    return result;
  }

  private lookupVTokenFromYieldSummary(
    position: StrategyPosition,
    chainId: string,
    yieldSummary?: AccountYieldSummaryResponse
  ): string | null {
    const lendingSummary = yieldSummary?.activeInvestments?.lendingInvestments;
    if (!lendingSummary?.positions?.length) {
      return null;
    }

    const normalizedProtocol = this.normalizeProtocolType(position.protocol);
    const asset = (position.asset || "").trim();
    const isAssetAddress = asset.startsWith("0x");
    const assetSymbolUpper = asset.toUpperCase();
    const assetAddress = isAssetAddress
      ? asset.toLowerCase()
      : (lookupTokenAddress(asset, chainId)?.toLowerCase() ?? null);

    const lendingPositions =
      lendingSummary.positions as AccountLendingPosition[];

    for (const lendingPosition of lendingPositions) {
      const lendingProtocol = this.normalizeProtocolType(
        lendingPosition.protocol
      );
      if (lendingProtocol !== normalizedProtocol) {
        continue;
      }

      const protocolPositions = this.toArray<AccountLendingProtocolPosition>(
        lendingPosition.protocolPositions
      );

      for (const protocolPosition of protocolPositions) {
        const supplies = this.toArray<AccountLendingSupply>(
          protocolPosition?.supplies
        );
        for (const supply of supplies) {
          const supplySymbolUpper = supply.tokenSymbol?.toUpperCase?.() ?? "";
          const supplyAddressLower = supply.tokenAddress?.toLowerCase?.() ?? "";
          const symbolMatches =
            !isAssetAddress &&
            assetSymbolUpper &&
            supplySymbolUpper === assetSymbolUpper;
          const addressMatches =
            assetAddress && supplyAddressLower === assetAddress;

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
      throw new Error("LP position missing poolAddress");
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

    const token0Address =
      extended.token0Address || extended.poolInfo?.token0Address;
    const token1Address =
      extended.token1Address || extended.poolInfo?.token1Address;
    const token0Amount =
      extended.token0Amount || extended.poolInfo?.token0Amount;
    const token1Amount =
      extended.token1Amount || extended.poolInfo?.token1Amount;
    const tickLower = extended.tickLower ?? extended.poolInfo?.tickLower;
    const tickUpper = extended.tickUpper ?? extended.poolInfo?.tickUpper;

    if (!token0Address || !token1Address) {
      throw new Error(
        `LP position ${position.poolAddress} missing token addresses`
      );
    }

    if (token0Amount === undefined || token1Amount === undefined) {
      throw new Error(
        `LP position ${position.poolAddress} missing token amounts`
      );
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
    const normalized = protocol?.toLowerCase?.() ?? "";
    if (normalized.includes("aave")) return "aave";
    if (normalized.includes("euler")) return "euler";
    if (normalized.includes("venus")) return "venus";
    throw new Error(`Unsupported lending protocol "${protocol}"`);
  }

  private normalizeLpProtocol(
    protocol: string | undefined
  ): "uniswapV3" | "aerodromeSlipstream" {
    if (!protocol) throw new Error("LP protocol required");
    const normalized = protocol.toLowerCase();
    if (normalized.includes("uniswap")) return "uniswapV3";
    if (normalized.includes("aerodrome")) return "aerodromeSlipstream";
    throw new Error(`Invalid LP protocol: "${protocol}"`);
  }
}
