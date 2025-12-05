import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { DocService } from './docs.service';

@Module({
  controllers: [AgentController],
  providers: [DocService],
  exports: [DocService],
})
export class AgentModule {}
