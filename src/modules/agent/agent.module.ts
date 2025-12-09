import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AgentController } from './agent.controller';
import { DocService } from './docs.service';
import { EnhancedRagService } from './enhanced-rag.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AgentController],
  providers: [DocService, EnhancedRagService],
  exports: [DocService, EnhancedRagService],
})
export class AgentModule {}
