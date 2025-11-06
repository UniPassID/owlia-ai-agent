import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { UserService } from "./user.service";
import { RegisterUserDto } from "./dtos/user.dto";

@Controller("account")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get("info")
  async getUserInfo(
    @Query("chainId") chainId: string,
    @Query("wallet") wallet: string
  ) {
    return this.userService.getUserInfo(chainId, wallet);
  }

  @Post("register")
  async registerUser(@Body() dto: RegisterUserDto) {
    return this.userService.registerUser(dto.chainId, dto.wallet, dto.sig);
  }
}
