import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RebalanceController } from "./rebalance.controller";
import { RebalanceJob } from "../entities/rebalance-job.entity";
import { MonitorModule } from "../monitor/monitor.module";
import { AgentModule } from "../agent/agent.module";
import { RebalanceExecutionSnapshot } from "../entities/rebalance-execution-snapshot.entity";
import { UserV2 } from "../entities/user-v2.entity";
import { UserV2Deployment } from "../entities/user-v2-deployment.entity";
import { UserModule } from "../user/user.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RebalanceJob,
      UserV2,
      UserV2Deployment,
      RebalanceExecutionSnapshot,
    ]),
    MonitorModule,
    UserModule,
    AgentModule,
  ],
  controllers: [RebalanceController],
})
export class ApiModule {}
