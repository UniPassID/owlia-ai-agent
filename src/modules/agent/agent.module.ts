import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { DocService } from './docs.service';
import { AgentService } from './agent.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  controllers: [AgentController],
  providers: [DocService, AgentService],
  exports: [DocService, AgentService],
  imports: [ConfigModule],
})
export class AgentModule {}
