import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AgentController } from './agent.controller';
import { DocService } from './docs.service';
import { RagService } from './rag.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AgentController],
  providers: [DocService, RagService],
  exports: [DocService, RagService],
})
export class AgentModule {}
