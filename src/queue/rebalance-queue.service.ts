import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, Job } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RebalanceJob, JobStatus } from '../entities/rebalance-job.entity';
import { User } from '../entities/user.entity';
import { UserPolicy } from '../entities/user-policy.entity';
import { AgentService } from '../agent/agent.service';
import { GuardService } from '../guard/guard.service';
import { convertPlanToSteps } from '../utils/plan-to-steps.util';
import { RebalancePlan } from '../agent/agent.types';

export interface RebalanceJobData {
  jobId: string;
  userId: string;
  trigger: string;
}

@Injectable()
export class RebalanceQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RebalanceQueueService.name);
  private queue: Queue<RebalanceJobData>;
  private worker: Worker<RebalanceJobData>;
  private redisConnection: { host: string; port: number };

  // Track consecutive failures per user for exponential backoff
  private userFailureCount: Map<string, number> = new Map();

  // Track active/pending jobs per user to prevent duplicates
  private activeUserJobs: Map<string, string> = new Map(); // userId -> jobId

  constructor(
    private configService: ConfigService,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(UserPolicy)
    private userPolicyRepo: Repository<UserPolicy>,
    @InjectRepository(RebalanceJob)
    private jobRepo: Repository<RebalanceJob>,
    private agentService: AgentService,
    private guardService: GuardService,
  ) {
    // Redis connection config
    this.redisConnection = {
      host: this.configService.get('REDIS_HOST', 'localhost'),
      port: this.configService.get('REDIS_PORT', 6379),
    };
  }

  async onModuleInit() {
    // Initialize Queue
    this.queue = new Queue<RebalanceJobData>('rebalance-jobs', {
      connection: this.redisConnection,
      defaultJobOptions: {
        attempts: 1, // Single attempt; do not requeue failed jobs
        backoff: {
          type: 'exponential',
          delay: 5000, // Start with 5 seconds
        },
        removeOnComplete: {
          age: 86400, // Keep completed jobs for 24 hours
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: {
          age: 604800, // Keep failed jobs for 7 days
        },
      },
    });

    // Initialize Worker with concurrency 1 for serial processing
    this.worker = new Worker<RebalanceJobData>(
      'rebalance-jobs',
      async (job: Job<RebalanceJobData>) => {
        return await this.processRebalanceJob(job);
      },
      {
        connection: this.redisConnection,
        concurrency: 1, // Process one job at a time (serial execution)
        limiter: {
          max: 1, // Maximum 1 job
          duration: 5000, // per 5 seconds (rate limiting)
        },
      },
    );

    // Event handlers
    this.worker.on('completed', (job) => {
      this.logger.log(`Job ${job.id} completed successfully`);
      // Reset failure count on success and remove from active jobs
      if (job.data.userId) {
        this.userFailureCount.delete(job.data.userId);
        this.activeUserJobs.delete(job.data.userId);
      }
    });

    this.worker.on('failed', (job, err) => {
      this.logger.error(`Job ${job?.id} failed: ${err.message}`);
      // Increment failure count for exponential backoff and remove from active jobs
      if (job?.data.userId) {
        const currentCount = this.userFailureCount.get(job.data.userId) || 0;
        this.userFailureCount.set(job.data.userId, currentCount + 1);
        this.activeUserJobs.delete(job.data.userId);
      }
    });

    this.worker.on('error', (err) => {
      this.logger.error(`Worker error: ${err.message}`);
    });

    this.logger.log('Rebalance queue and worker initialized');
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.logger.log('Worker closed');
    }
    if (this.queue) {
      await this.queue.close();
      this.logger.log('Queue closed');
    }
  }

  /**
   * Add a rebalance job to the queue
   */
  async addRebalanceJob(
    jobId: string,
    userId: string,
    trigger: string,
  ): Promise<{ added: boolean; reason?: string }> {
    // Check if user already has an active/pending job
    const existingJobId = this.activeUserJobs.get(userId);
    if (existingJobId) {
      // Double check the job status in database
      const existingJob = await this.jobRepo.findOne({ where: { id: existingJobId } });

      if (existingJob &&
          (existingJob.status === JobStatus.PENDING ||
           existingJob.status === JobStatus.SIMULATING ||
           existingJob.status === JobStatus.EXECUTING)) {
        this.logger.log(
          `Skipping job ${jobId} for user ${userId} - already has active job ${existingJobId} with status ${existingJob.status}`,
        );
        return {
          added: false,
          reason: `User already has an active rebalance job (${existingJobId}) in progress`
        };
      } else {
        // Existing job is no longer active, clean up
        this.activeUserJobs.delete(userId);
      }
    }

    // Also check database for any pending/active jobs for this user
    const activeJobs = await this.jobRepo.find({
      where: [
        { userId, status: JobStatus.PENDING },
        { userId, status: JobStatus.SIMULATING },
        { userId, status: JobStatus.EXECUTING },
      ],
      order: { createdAt: 'DESC' },
      take: 1,
    });

    if (activeJobs.length > 0 && activeJobs[0].id !== jobId) {
      this.logger.log(
        `Skipping job ${jobId} for user ${userId} - found active job ${activeJobs[0].id} in database`,
      );
      // Update our tracking
      this.activeUserJobs.set(userId, activeJobs[0].id);
      return {
        added: false,
        reason: `User already has an active rebalance job (${activeJobs[0].id}) in progress`
      };
    }

    // Track this job as active
    this.activeUserJobs.set(userId, jobId);

    // Calculate delay based on user's consecutive failures (exponential backoff)
    const failureCount = this.userFailureCount.get(userId) || 0;
    const delay = failureCount > 0 ? Math.pow(2, failureCount) * 30000 : 0; // 30s, 60s, 120s, 240s...

    if (delay > 0) {
      this.logger.log(
        `User ${userId} has ${failureCount} consecutive failures, adding ${delay}ms delay`,
      );
    }

    await this.queue.add(
      'process-rebalance',
      { jobId, userId, trigger },
      {
        jobId: jobId, // Use our job ID as BullMQ job ID for tracking
        delay,
        priority: trigger === 'manual_trigger' ? 1 : 10, // Manual triggers get higher priority
      },
    );

    this.logger.log(`Job ${jobId} added to queue with delay ${delay}ms`);
    return { added: true };
  }

  /**
   * Process a rebalance job (extracted from MonitorService)
   */
  private async processRebalanceJob(
    bullJob: Job<RebalanceJobData>,
  ): Promise<void> {
    const { jobId, userId, trigger } = bullJob.data;

    this.logger.log(`Processing job ${jobId} for user ${userId}`);

    // Get job from database
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) {
      throw new Error(`Job ${jobId} not found in database`);
    }

    // Get user and policy
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }

    const policy = await this.userPolicyRepo.findOne({ where: { userId } });

    try {
      // Update status to simulating
      job.status = JobStatus.SIMULATING;
      await this.jobRepo.save(job);

      // Run agent to analyze and simulate
      const agentResult = await this.agentService.runRebalanceAgent({
        userId: job.userId,
        userAddress: user.address,
        jobId: job.id,
        userPolicy: {
          chains: policy?.chains || [user.chainId],
          assetWhitelist: policy?.assetWhitelist || [],
          minAprLiftBps: policy?.minAprLiftBps || 50,
          minNetUsd: policy ? Number(policy.minNetUsd) : 10,
          minHealthFactor: policy ? Number(policy.minHealthFactor) : 1.5,
          maxSlippageBps: policy?.maxSlippageBps || 100,
          maxGasUsd: policy ? Number(policy.maxGasUsd) : 50,
          maxPerTradeUsd: policy ? Number(policy.maxPerTradeUsd) : 10000,
        },
        trigger: job.trigger,
      });

      if (!agentResult.success) {
        throw new Error(agentResult.error || 'Agent failed');
      }

      const data = agentResult.data;
      if (!data || !('simulation' in data) || !('plan' in data)) {
        this.logger.warn(`Agent result for job ${job.id} is not a rebalance analysis payload; skipping execution`);
        job.status = JobStatus.REJECTED;
        job.errorMessage = 'Agent result missing rebalance analysis data';
        await this.jobRepo.save(job);
        return;
      }

      const simulation = data.simulation;
      const plan = data.plan as RebalancePlan | null;

      // Check if rebalancing is not needed
      if (data.shouldRebalance === false) {
        job.status = JobStatus.COMPLETED;

        // Generate steps for "no rebalancing needed" scenario
        const currentPositions = data.currentStrategy || plan?.currentPositions || [];
        const reason = data.reasoning || data.analysis?.reason || 'Current allocation is already optimal';

        const noRebalanceResult = convertPlanToSteps(
          {
            description: 'Current allocation optimal',
            recommendation: reason,
            hasOpportunity: false,
            shouldRebalance: false,
            currentPositions: Array.isArray(currentPositions) ? currentPositions : [currentPositions],
            opportunities: [],
            chainId: user.chainId || (policy?.chains?.[0] ?? '8453'),
            userAddress: user.address,
            costEstimates: [],
          },
          null,
          JobStatus.COMPLETED
        );

        job.execResult = {
          success: true,
          output: reason,
          ...noRebalanceResult,
        };
        job.completedAt = new Date();
        await this.jobRepo.save(job);
        this.logger.log(`Job ${job.id} completed: no rebalancing needed`);
        return;
      }

      if (!simulation || !plan) {
        job.status = JobStatus.REJECTED;
        job.errorMessage = 'No simulation or plan generated - analysis incomplete';
        await this.jobRepo.save(job);
        this.logger.log(`Job ${job.id} rejected: analysis incomplete`);
        return;
      }

      // Store simulation and plan with steps
      const executionResult = convertPlanToSteps(plan, null, JobStatus.SIMULATING);
      job.simulateReport = {
        ...simulation,
        plan,
        ...executionResult,
      };
      await this.jobRepo.save(job);

      // Guard approval
      const guardResult = this.guardService.approveSimulation(simulation, policy);

      if (!guardResult.approved) {
        job.status = JobStatus.REJECTED;
        job.errorMessage = guardResult.reason;
        await this.jobRepo.save(job);
        this.logger.warn(`Job ${job.id} rejected by guard: ${guardResult.reason}`);
        return;
      }

      // Check if auto-execution is allowed
      const totalValueUsd = simulation.netGainUsd + simulation.gasCostUsd;
      if (policy && !this.guardService.canAutoExecute(policy, totalValueUsd)) {
        job.status = JobStatus.APPROVED;
        await this.jobRepo.save(job);
        this.logger.log(`Job ${job.id} approved but requires manual execution`);
        return;
      }

      // Execute
      job.status = JobStatus.EXECUTING;
      await this.jobRepo.save(job);

      // Get user address from input context
      const inputContext = typeof job.inputContext === 'string'
        ? JSON.parse(job.inputContext)
        : job.inputContext;
      const userAddress = inputContext?.userAddress || user.address;

      const execResult = await this.agentService.executeRebalance(
        job.userId,
        plan,
        job.id,
        userAddress,
      );

      // Update steps with execution result
      const finalExecutionResult = convertPlanToSteps(
        plan,
        execResult,
        execResult.success ? JobStatus.COMPLETED : JobStatus.FAILED
      );

      job.execResult = {
        ...execResult,
        ...finalExecutionResult,
      };
      job.status = execResult.success ? JobStatus.COMPLETED : JobStatus.FAILED;
      job.completedAt = new Date();
      await this.jobRepo.save(job);

      this.logger.log(`Job ${job.id} ${job.status}`);

      // If execution failed, throw error to trigger BullMQ retry
      if (!execResult.success) {
        throw new Error(execResult.error || 'Execution failed');
      }
    } catch (error) {
      job.status = JobStatus.FAILED;
      job.errorMessage = error.message;
      await this.jobRepo.save(job);
      throw error; // Re-throw to let BullMQ handle retry
    }
  }

  /**
   * Get queue metrics
   */
  async getQueueMetrics() {
    const waiting = await this.queue.getWaitingCount();
    const active = await this.queue.getActiveCount();
    const completed = await this.queue.getCompletedCount();
    const failed = await this.queue.getFailedCount();
    const delayed = await this.queue.getDelayedCount();

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + delayed,
    };
  }

  /**
   * Clear all jobs from queue (for maintenance)
   */
  async clearQueue() {
    await this.queue.drain();
    this.logger.log('Queue cleared');
  }
}
