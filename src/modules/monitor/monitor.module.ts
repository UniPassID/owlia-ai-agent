import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MonitorService } from './monitor.service';
import { MonitorController } from './monitor.controller';
import { AgentModule } from '../agent/agent.module';
import { RebalancePrecheckService } from './rebalance-precheck.service';
import { RebalanceSummaryService } from './rebalance-summary.service';
import { TransactionParserService } from './transaction-parser.service';
import { PortfolioOptimizerModule } from './portfolio-optimizer/portfolio-optimizer.module';
import { UserModule } from '../user/user.module';
import { RebalanceJob } from './entities/rebalance-job.entity';
import { RebalanceExecutionSnapshot } from './entities/rebalance-execution-snapshot.entity';
import { RebalanceLoggerService } from './utils/rebalance-logger.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RebalanceJob, RebalanceExecutionSnapshot]),
    AgentModule,
    PortfolioOptimizerModule,
    UserModule,
  ],
  controllers: [MonitorController],
  providers: [
    MonitorService,
    RebalancePrecheckService,
    RebalanceSummaryService,
    TransactionParserService,
    RebalanceLoggerService,
  ],
  exports: [MonitorService],
})
export class MonitorModule {}
