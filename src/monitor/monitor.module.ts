import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitorService } from './monitor.service';
import { User } from '../entities/user.entity';
import { UserPolicy } from '../entities/user-policy.entity';
import { RebalanceJob } from '../entities/rebalance-job.entity';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserPolicy, RebalanceJob]),
    QueueModule,
  ],
  providers: [MonitorService],
  exports: [MonitorService],
})
export class MonitorModule {}
