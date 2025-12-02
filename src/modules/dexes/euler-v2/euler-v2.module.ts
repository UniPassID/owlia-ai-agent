import { Module } from '@nestjs/common';
import { EulerV2Service } from './euler-v2.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  providers: [EulerV2Service],
  exports: [EulerV2Service],
  imports: [ConfigModule],
})
export class EulerV2Module {}
