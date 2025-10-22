import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RebalanceController } from './rebalance.controller';
import { UserPolicy } from '../entities/user-policy.entity';
import { RebalanceJob } from '../entities/rebalance-job.entity';
import { User } from '../entities/user.entity';
import { MonitorModule } from '../monitor/monitor.module';
import { AgentModule } from '../agent/agent.module';
import { UserModule } from './user.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserPolicy, RebalanceJob, User]),
    MonitorModule,
    AgentModule,
    UserModule,
  ],
  controllers: [RebalanceController],
})
export class ApiModule {}
