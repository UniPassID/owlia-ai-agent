import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPolicy } from '../entities/user-policy.entity';
import { User } from '../entities/user.entity';
import { RebalanceJob, JobStatus } from '../entities/rebalance-job.entity';
import { RebalanceQueueService } from '../queue/rebalance-queue.service';

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
    private queueService: RebalanceQueueService,
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
