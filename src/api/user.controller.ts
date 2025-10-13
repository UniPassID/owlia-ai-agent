import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { RegisterUserDto } from './dto/user.dto';
import { UserService } from './user.service';

@Controller('user')
export class UserController {
  constructor(private userService: UserService) {}

  /**
   * Register a new user
   */
  @Post('register')
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
