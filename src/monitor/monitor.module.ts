import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { MonitorService } from "./monitor.service";
import { MonitorController } from "./monitor.controller";
import { User } from "../entities/user.entity";
import { RebalanceJob } from "../entities/rebalance-job.entity";
import { RebalanceExecutionSnapshot } from "../entities/rebalance-execution-snapshot.entity";
import { AgentModule } from "../agent/agent.module";
import { RebalancePrecheckService } from "./rebalance-precheck.service";
import { RebalanceSummaryService } from "./rebalance-summary.service";
import { TransactionParserService } from "./transaction-parser.service";
import { PortfolioOptimizerModule } from "./portfolio-optimizer/portfolio-optimizer.module";
import { RebalanceLoggerService } from "../utils/rebalance-logger.service";
import { UserV2Deployment } from "../entities/user-v2-deployment.entity";
import { UserModule } from "../user/user.module";
import { UserV2 } from "../entities/user-v2.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RebalanceJob,
      UserV2,
      UserV2Deployment,
      RebalanceExecutionSnapshot,
    ]),
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
