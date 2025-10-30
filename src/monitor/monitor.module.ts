import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitorService } from './monitor.service';
import { MonitorController } from './monitor.controller';
import { User } from '../entities/user.entity';
import { UserPolicy } from '../entities/user-policy.entity';
import { RebalanceJob } from '../entities/rebalance-job.entity';
import { AgentModule } from '../agent/agent.module';
import { RebalancePrecheckService } from './rebalance-precheck.service';
import { UserModule } from '../api/user.module';
import { PortfolioOptimizerModule } from './portfolio-optimizer/portfolio-optimizer.module';
import { RebalanceLoggerService } from '../utils/rebalance-logger.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserPolicy, RebalanceJob]),
    AgentModule,
    UserModule,
    PortfolioOptimizerModule,
  ],
  controllers: [MonitorController],
  providers: [MonitorService, RebalancePrecheckService, RebalanceLoggerService],
  exports: [MonitorService],
})
export class MonitorModule {}
