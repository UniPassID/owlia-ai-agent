import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserDeployment } from './entities/user-deployment.entity';
import { DeploymentModule } from '../deployment/deployment.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  providers: [UserService],
  controllers: [UserController],
  imports: [
    TypeOrmModule.forFeature([User, UserDeployment]),
    DeploymentModule,
    ConfigModule,
  ],
})
export class UserModule {}
