import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPolicy } from '../entities/user-policy.entity';
import { User } from '../entities/user.entity';
import { RebalanceJob, JobStatus } from '../entities/rebalance-job.entity';
import { AgentService } from '../agent/agent.service';
import { GuardService } from '../guard/guard.service';
import { convertPlanToSteps } from '../utils/plan-to-steps.util';

@Injectable()
export class MonitorService {
  private readonly logger = new Logger(MonitorService.name);

  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
    @InjectRepository(UserPolicy)
    private userPolicyRepo: Repository<UserPolicy>,
    @InjectRepository(RebalanceJob)
    private jobRepo: Repository<RebalanceJob>,
    private agentService: AgentService,
    private guardService: GuardService,
  ) {}

  /**
   * Scheduled task to monitor all users with auto-enabled
   */
  // @Cron(CronExpression.EVERY_5_MINUTES)
  async monitorAllUsers() {
    this.logger.log('Starting scheduled monitoring...');

    try {
      const enabledPolicies = await this.userPolicyRepo.find({
        where: { autoEnabled: true },
      });

      this.logger.log(`Found ${enabledPolicies.length} users with auto-enabled`);

      for (const policy of enabledPolicies) {
        try {
          await this.checkUserPositions(policy);
        } catch (error) {
          this.logger.error(
            `Failed to monitor user ${policy.userId}: ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Monitoring task failed: ${error.message}`);
    }
  }

  /**
   * Check a specific user's positions and trigger rebalance if needed
   * Agent will analyze positions and determine if rebalancing is beneficial
   */
  async checkUserPositions(policy: UserPolicy): Promise<void> {
    this.logger.log(`Checking positions for user ${policy.userId}`);

    // Get user info
    const user = await this.userRepo.findOne({ where: { id: policy.userId } });
    if (!user) {
      this.logger.error(`User ${policy.userId} not found`);
      return;
    }

    // Trigger rebalance check - let agent decide
    await this.triggerRebalance(user, policy, 'scheduled_monitor');
  }

  /**
   * Trigger a rebalance job for a user
   */
  async triggerRebalance(
    user: User,
    policy: UserPolicy | null,
    trigger: string,
  ): Promise<RebalanceJob> {
    // Create job record
    const job = this.jobRepo.create({
      userId: user.id,
      trigger,
      status: JobStatus.PENDING,
    });
    await this.jobRepo.save(job);

    this.logger.log(`Created rebalance job ${job.id} for user ${user.id}`);

    // Execute rebalance asynchronously
    this.executeRebalanceJob(job, user, policy).catch((error) => {
      this.logger.error(`Job ${job.id} failed: ${error.message}`);
    });

    return job;
  }

  /**
   * Execute a rebalance job
   */
  private async executeRebalanceJob(
    job: RebalanceJob,
    user: User,
    policy: UserPolicy | null,
  ): Promise<void> {
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

      const simulation = agentResult.data?.simulation;
      const plan = agentResult.data?.plan;

      // Log what we received
      this.logger.log(`Agent result - action: ${agentResult.action}`);
      this.logger.log(`Agent result - has simulation: ${!!simulation}`);
      this.logger.log(`Agent result - has plan: ${!!plan}`);
      this.logger.log(`Agent result - has reasoning: ${!!agentResult.data?.reasoning}`);
      this.logger.log(`Agent result - has toolResults: ${agentResult.data?.toolResults?.length || 0}`);

      if (simulation) {
        this.logger.log(`Simulation type: ${typeof simulation}, keys: ${Object.keys(simulation).join(', ')}`);
      }
      if (plan) {
        this.logger.log(`Plan type: ${typeof plan}, keys: ${Object.keys(plan).join(', ')}`);
      }

      if (!simulation || !plan) {
        job.status = JobStatus.REJECTED;
        job.errorMessage = 'No simulation or plan generated - likely no beneficial rebalance opportunity';
        await this.jobRepo.save(job);
        this.logger.log(`Job ${job.id} rejected: no rebalance opportunity found`);
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
    } catch (error) {
      job.status = JobStatus.FAILED;
      job.errorMessage = error.message;
      await this.jobRepo.save(job);
      throw error;
    }
  }
}
