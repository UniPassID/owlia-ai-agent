import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { getDatabaseConfig } from './config/database.config';
import { AgentModule } from './agent/agent.module';
import { GuardModule } from './guard/guard.module';
import { MonitorModule } from './monitor/monitor.module';
import { ApiModule } from './api/api.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: getDatabaseConfig,
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Application modules
    AgentModule,
    GuardModule,
    MonitorModule,
    ApiModule,
  ],
})
export class AppModule {}
