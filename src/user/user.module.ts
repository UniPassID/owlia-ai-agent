import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserService } from "./user.service";
import { UserV2 } from "../entities/user-v2.entity";
import { ConfigModule } from "@nestjs/config";
import { UserController } from "./user.controller";
import { UserV2Deployment } from "../entities/user-v2-deployment.entity";

@Module({
  imports: [TypeOrmModule.forFeature([UserV2, UserV2Deployment]), ConfigModule],
  providers: [UserService],
  exports: [UserService],
  controllers: [UserController],
})
export class UserModule {}
