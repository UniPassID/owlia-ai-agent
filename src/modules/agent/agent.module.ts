import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { DocService } from './docs.service';
import { AgentService } from './agent.service';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../user/entities/user.entity';
import { RebalanceJob } from './entities/rebalance-job.entity';
import { RebalanceExecutionSnapshot } from './entities/rebalance-execution-snapshot.entity';
import { UserModule } from '../user/user.module';

@Module({
  controllers: [AgentController],
  providers: [DocService, AgentService],
  exports: [DocService, AgentService],
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([User, RebalanceJob, RebalanceExecutionSnapshot]),
    UserModule,
  ],
})
export class AgentModule {}
