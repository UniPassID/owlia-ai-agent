import { Module } from '@nestjs/common';
import { OwliaGuardService } from './owlia-guard.service';
import { AaveV3Module } from '../dexes/aave-v3/aave-v3.module';
import { AerodromeClModule } from '../dexes/aerodrome-cl/aerodrome-cl.module';
import { EulerV2Module } from '../dexes/euler-v2/euler-v2.module';
import { VenusV4Module } from '../dexes/venus-v4/venus-v4.module';
import { UniswapV3Module } from '../dexes/uniswap-v3/uniswap-v3.module';
import { OwliaGuardController } from './owlia-guard.controller';
import { UserModule } from '../user/user.module';
import { ConfigModule } from '@nestjs/config';
import { TrackerModule } from '../tracker/tracker.module';

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
    TrackerModule,
  ],
  controllers: [OwliaGuardController],
  exports: [OwliaGuardService],
})
export class OwliaGuardModule {}
