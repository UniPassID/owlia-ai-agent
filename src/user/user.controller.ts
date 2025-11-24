import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { UserResponseDto } from './dto/user.response.dto';
import { ApiOk } from '../common/dto/response.dto';
import { ApiTags } from '@nestjs/swagger';
import { RegisterUserDto } from './dto/register-user.dto';
import { NetworkDto } from './dto/common.dto';
import { PortfolioResponseDto } from './dto/portfolio.response.dto';
import { UserService } from './user.service';

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
    throw new Error('Not implemented');
  }

  @Post('register')
  @ApiOk(UserResponseDto)
  async registerUser(@Body() body: RegisterUserDto): Promise<UserResponseDto> {
    throw new Error('Not implemented');
  }

  @Get('portfolio')
  @ApiOk(PortfolioResponseDto)
  async getPositions(
    @Query('network') network: NetworkDto,
    @Query('address') address: string,
  ): Promise<PortfolioResponseDto> {
    throw new Error('Not implemented');
  }
}
