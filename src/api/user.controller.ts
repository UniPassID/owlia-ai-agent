import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { RegisterUserDto } from './dto/user.dto';
import { UserService } from './user.service';

@ApiTags('user')
@Controller('user')
export class UserController {
  constructor(private userService: UserService) {}

  /**
   * Register a new user
   */
  @Post('register')
  @ApiOperation({ summary: 'Register a new user', description: 'Register a new user with wallet address and safe owner' })
  @ApiBody({ type: RegisterUserDto })
  @ApiResponse({ status: 201, description: 'User successfully registered' })
  @ApiResponse({ status: 400, description: 'Bad request - validation failed' })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async register(@Body() dto: RegisterUserDto) {
    try {
      const user = await this.userService.register(dto);

      return {
        success: true,
        data: {
          id: user.id,
          address: user.address,
          chainId: user.chainId,
          createdAt: user.createdAt,
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        { success: false, error: error.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
