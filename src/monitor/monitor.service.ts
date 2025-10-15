import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPolicy } from '../entities/user-policy.entity';
import { User } from '../entities/user.entity';
import { RebalanceJob, JobStatus } from '../entities/rebalance-job.entity';
import { RebalanceQueueService } from '../queue/rebalance-queue.service';
import { RebalancePrecheckService } from './rebalance-precheck.service';

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

    // Trigger rebalance check - let agent decide
    try {
      const precheck = await this.precheckService.evaluate(user, policy);
      if (!precheck.shouldTrigger) {
        this.logger.log(
          `Skipped rebalance for user ${user.id}: portfolio APY ${precheck.portfolioApy.toFixed(2)}% ` +
          `vs opportunity APY ${precheck.opportunityApy.toFixed(2)}% (diff ${precheck.differenceBps.toFixed(2)} bps)`,
        );
        return;
      }
    } catch (error) {
      this.logger.warn(
        `Precheck failed for user ${user.id}: ${error.message}. Proceeding with trigger.`,
      );
    }

    // Trigger rebalance check - let agent decide
    await this.triggerRebalance(user, policy, 'scheduled_monitor');
  }

  async evaluateUserPrecheckByAddress(address: string) {
    const user = await this.userRepo.findOne({ where: { address } });
    if (!user) {
      throw new NotFoundException(`User with address ${address} not found`);
    }

    const policy = await this.userPolicyRepo.findOne({ where: { userId: user.id } });
    return this.precheckService.evaluate(user, policy);
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

    // Add job to queue for async processing
    const result = await this.queueService.addRebalanceJob(job.id, user.id, trigger);

    if (!result.added) {
      // Job was not added due to duplicate, mark as rejected
      job.status = JobStatus.REJECTED;
      job.errorMessage = result.reason || 'Duplicate job detected';
      await this.jobRepo.save(job);
      this.logger.log(`Job ${job.id} rejected: ${result.reason}`);
    }

    return job;
  }

}
