import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { UserResponseDto } from './dto/user.response.dto';
import { ApiOk } from '../common/dto/response.dto';
import { ApiTags } from '@nestjs/swagger';
import { RegisterUserDto } from './dto/register-user.dto';
import {
  PortfolioResponseDto,
  UserPortfoliosResponseDto,
} from './dto/user-portfolio.response.dto';
import { UserService } from './user.service';
import {
  UserPortfolioRequestDto,
  UserPortfoliosRequestDto,
} from './dto/user-portfolio.dto';

@Controller({
  path: 'user',
  version: '1',
})
@ApiTags('User')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('')
  @ApiOk(UserResponseDto)
  async getUserInfo(@Query('owner') owner: string): Promise<UserResponseDto> {
    return this.userService.getUserInfo(owner);
  }

  @Post('register')
  @ApiOk(UserResponseDto)
  async registerUser(@Body() body: RegisterUserDto): Promise<UserResponseDto> {
    return this.userService.registerUser(
      body.network,
      body.owner,
      body.validators,
      body.signature,
    );
  }

  @Get('portfolio')
  @ApiOk(PortfolioResponseDto)
  async getPositions(
    @Query() query: UserPortfolioRequestDto,
  ): Promise<PortfolioResponseDto> {
    return this.userService.getUserPortfolio(query.network, query.address);
  }

  @Post('portfolios')
  @ApiOk(UserPortfoliosResponseDto)
  async getPortfolios(
    @Body() body: UserPortfoliosRequestDto,
  ): Promise<UserPortfoliosResponseDto> {
    return this.userService.getUserPortfolios(body);
  }
}
