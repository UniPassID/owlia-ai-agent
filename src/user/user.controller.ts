import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { UserService } from "./user.service";
import {
  NetworkDto,
  RegisterUserRequestDto,
  UserResponseDto,
} from "./dtos/user.dto";
import { ApiResponse, ApiTags } from "@nestjs/swagger";

@Controller("account")
@ApiTags("account")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get("info")
  @ApiResponse({ type: UserResponseDto })
  async getUserInfo(@Query("wallet") wallet: string) {
    return this.userService.getUserInfo(wallet);
  }

  @Post("register")
  @ApiResponse({ type: UserResponseDto })
  async registerUser(@Body() dto: RegisterUserRequestDto) {
    return this.userService.registerUser(dto.network, dto.wallet, dto.sig);
  }
}
