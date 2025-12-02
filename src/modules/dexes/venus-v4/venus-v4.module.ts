import { Module } from '@nestjs/common';
import { VenusV4Service } from './venus-v4.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  providers: [VenusV4Service],
  exports: [VenusV4Service],
  imports: [ConfigModule],
})
export class VenusV4Module {}
