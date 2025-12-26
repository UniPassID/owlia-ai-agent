import { Module } from '@nestjs/common';
import { CompoundV3Service } from './compound-v3.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  providers: [CompoundV3Service],
  exports: [CompoundV3Service],
  imports: [ConfigModule],
})
export class CompoundV3Module {}
