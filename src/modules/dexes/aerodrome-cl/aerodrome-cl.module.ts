import { Module } from '@nestjs/common';
import { AerodromeClService } from './aerodrome-cl.service';
import { ConfigModule } from '@nestjs/config';
import { TrackerModule } from '../../tracker/tracker.module';

@Module({
  providers: [AerodromeClService],
  exports: [AerodromeClService],
  imports: [ConfigModule, TrackerModule],
})
export class AerodromeClModule {}
