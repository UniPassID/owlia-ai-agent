import { Module } from '@nestjs/common';
import { UniswapV3Service } from './uniswap-v3.service';
import { ConfigModule } from '@nestjs/config';
import { TrackerModule } from '../../tracker/tracker.module';

@Module({
  providers: [UniswapV3Service],
  exports: [UniswapV3Service],
  imports: [ConfigModule, TrackerModule],
})
export class UniswapV3Module {}
