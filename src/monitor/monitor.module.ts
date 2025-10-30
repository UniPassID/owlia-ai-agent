import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitorService } from './monitor.service';
import { MonitorController } from './monitor.controller';
import { User } from '../entities/user.entity';
import { UserPolicy } from '../entities/user-policy.entity';
import { RebalanceJob } from '../entities/rebalance-job.entity';
import { QueueModule } from '../queue/queue.module';
import { AgentModule } from '../agent/agent.module';
import { RebalancePrecheckService } from './rebalance-precheck.service';
import { UserModule } from '../api/user.module';
import { PortfolioOptimizerModule } from './portfolio-optimizer/portfolio-optimizer.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserPolicy, RebalanceJob]),
    QueueModule,
    AgentModule,
    UserModule,
    PortfolioOptimizerModule,
  ],
  controllers: [MonitorController],
  providers: [MonitorService, RebalancePrecheckService],
  exports: [MonitorService],
})
export class MonitorModule {}
