import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserDeployment } from './entities/user-deployment.entity';
import { DeploymentModule } from '../deployment/deployment.module';
import { ConfigModule } from '@nestjs/config';
import { UserPortfolio } from './entities/user-portfolio.entity';
import { ScheduleModule } from '@nestjs/schedule';
import { AaveV3Module } from '../dexes/aave-v3/aave-v3.module';
import { EulerV2Module } from '../dexes/euler-v2/euler-v2.module';
import { TrackerModule } from '../tracker/tracker.module';

@Module({
  providers: [UserService],
  controllers: [UserController],
  imports: [
    TypeOrmModule.forFeature([User, UserDeployment, UserPortfolio]),
    DeploymentModule,
    ConfigModule,
    ScheduleModule,
    AaveV3Module,
    EulerV2Module,
    TrackerModule,
  ],
  exports: [UserService],
})
export class UserModule {}
