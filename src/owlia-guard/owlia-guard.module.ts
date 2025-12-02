import { Module } from '@nestjs/common';
import { OwliaGuardService } from './owlia-guard.service';
import { AaveV3Module } from '../aave-v3/aave-v3.module';
import { AerodromeClModule } from '../aerodrome-cl/aerodrome-cl.module';
import { EulerV2Module } from '../euler-v2/euler-v2.module';
import { VenusV4Module } from '../venus-v4/venus-v4.module';
import { UniswapV3Module } from '../uniswap-v3/uniswap-v3.module';
import { OwliaGuardController } from './owlia-guard.controller';
import { UserModule } from '../user/user.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  providers: [OwliaGuardService],
  imports: [
    AaveV3Module,
    AerodromeClModule,
    EulerV2Module,
    VenusV4Module,
    UniswapV3Module,
    UserModule,
    ConfigModule,
  ],
  controllers: [OwliaGuardController],
})
export class OwliaGuardModule {}
