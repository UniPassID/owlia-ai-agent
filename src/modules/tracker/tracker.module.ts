import { Module } from '@nestjs/common';
import { TrackerService } from './tracker.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  providers: [TrackerService],
  exports: [TrackerService],
  imports: [ConfigModule],
})
export class TrackerModule {}
