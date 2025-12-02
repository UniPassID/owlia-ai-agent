import { Module } from '@nestjs/common';
import { AaveV3Service } from './aave-v3.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  providers: [AaveV3Service],
  exports: [AaveV3Service],
  imports: [ConfigModule],
})
export class AaveV3Module {}
