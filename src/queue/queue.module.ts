import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RebalanceQueueService } from './rebalance-queue.service';
import { RebalanceJob } from '../entities/rebalance-job.entity';
import { User } from '../entities/user.entity';
import { UserPolicy } from '../entities/user-policy.entity';
import { AgentModule } from '../agent/agent.module';
import { GuardModule } from '../guard/guard.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RebalanceJob, User, UserPolicy]),
    AgentModule,
    GuardModule,
  ],
  providers: [RebalanceQueueService],
  exports: [RebalanceQueueService],
})
export class QueueModule {}
