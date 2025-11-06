import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserService } from "./user.service";
import { UserV2 } from "../entities/user-v2.entity";
import { ConfigModule } from "@nestjs/config";
import { UserController } from "./user.controller";

@Module({
  imports: [TypeOrmModule.forFeature([UserV2]), ConfigModule],
  providers: [UserService],
  exports: [UserService],
  controllers: [UserController],
})
export class UserModule {}
