import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RebalanceController } from './rebalance.controller';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserPolicy } from '../entities/user-policy.entity';
import { RebalanceJob } from '../entities/rebalance-job.entity';
import { User } from '../entities/user.entity';
import { MonitorModule } from '../monitor/monitor.module';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserPolicy, RebalanceJob, User]),
    MonitorModule,
    AgentModule,
  ],
  controllers: [RebalanceController, UserController],
  providers: [UserService],
})
export class ApiModule {}
