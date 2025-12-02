import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './modules/user/user.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DeploymentModule } from './modules/deployment/deployment.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import blockchainsConfig from './config/blockchains.config';
import trackerConfig from './config/tracker.config';
import { ScheduleModule } from '@nestjs/schedule';
import { OwliaGuardModule } from './modules/owlia-guard/owlia-guard.module';
import { AaveV3Module } from './modules/dexes/aave-v3/aave-v3.module';
import { EulerV2Module } from './modules/dexes/euler-v2/euler-v2.module';
import { AerodromeClModule } from './modules/dexes/aerodrome-cl/aerodrome-cl.module';
import { UniswapV3Module } from './modules/dexes/uniswap-v3/uniswap-v3.module';
import { VenusV4Module } from './modules/dexes/venus-v4/venus-v4.module';
import { TrackerModule } from './modules/tracker/tracker.module';
import privateConfig from './config/private.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, blockchainsConfig, trackerConfig, privateConfig],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get('database.host'),
        port: configService.get('database.port'),
        username: configService.get('database.username'),
        password: configService.get('database.password'),
        database: configService.get('database.database'),

        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/migrations/*.{ts,js}'],
        synchronize: false,
        logging: ['error'],
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    DeploymentModule,
    UserModule,
    OwliaGuardModule,
    AaveV3Module,
    EulerV2Module,
    AerodromeClModule,
    UniswapV3Module,
    VenusV4Module,
    TrackerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
