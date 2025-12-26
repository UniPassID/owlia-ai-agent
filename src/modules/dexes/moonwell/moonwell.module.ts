import { Module } from '@nestjs/common';
import { MoonwellService } from './moonwell.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule],
  providers: [MoonwellService],
  exports: [MoonwellService],
})
export class MoonwellModule {}
