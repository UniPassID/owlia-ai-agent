import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { DocService } from './docs.service';
import { RagService } from './rag.service';

@Module({
  controllers: [AgentController],
  providers: [DocService, RagService],
  exports: [DocService, RagService],
})
export class AgentModule {}
