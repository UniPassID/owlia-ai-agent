import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { UserModule } from './user/user.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DeploymentModule } from './deployment/deployment.module';
import { DeploymentController } from './deployment/deployment.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import databaseConfig from './config/database.config';
import blockchainsConfig from './config/blockchains.config';

@Module({
  imports: [
    UserModule,
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, blockchainsConfig],
    }),
    DeploymentModule,
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
        synchronize: false, // 生产环境禁止
        logging: ['error'],
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AppController, DeploymentController],
  providers: [AppService],
})
export class AppModule {}
