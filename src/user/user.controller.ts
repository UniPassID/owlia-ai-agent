import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { UserService } from "./user.service";
import {
  NetworkDto,
  RegisterUserRequestDto,
  UserResponseDto,
} from "./dtos/user.dto";
import { ApiBody, ApiResponse } from "@nestjs/swagger";

@Controller("account")
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get("info")
  @ApiResponse({ type: UserResponseDto })
  async getUserInfo(
    @Query("network") network: NetworkDto,
    @Query("wallet") wallet: string
  ) {
    return this.userService.getUserInfo(network, wallet);
  }

  @Post("register")
  @ApiResponse({ type: UserResponseDto })
  async registerUser(@Body() dto: RegisterUserRequestDto) {
    return this.userService.registerUser(dto.network, dto.wallet, dto.sig);
  }
}
