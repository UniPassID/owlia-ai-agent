import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NetworkDto } from '../../../common/dto/network.dto';
import { Address } from '../../../common/decorators/address.decorator';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class UserPortfolioRequestDto {
  @ApiProperty({
    description: 'The network of the user portfolio',
    enum: NetworkDto,
  })
  @IsEnum(NetworkDto)
  network: NetworkDto;

  @ApiProperty({
    description: 'The address of the user portfolio',
    example: '0x1234567890abcdef',
  })
  @Address()
  @IsString()
  address: string;
}

export class UserPortfoliosRequestDto {
  @ApiProperty({
    description: 'The network of the user portfolio',
    enum: NetworkDto,
  })
  @IsEnum(NetworkDto)
  network: NetworkDto;

  @ApiProperty({
    description: 'The address of the user portfolio',
    example: '0x1234567890abcdef',
  })
  @Address()
  @IsString()
  address: string;

  @ApiPropertyOptional({
    description: 'The snap time of the user portfolio',
    example: ['1716153600000', '1716153600000'],
  })
  @IsOptional()
  @IsArray()
  inMultiTimestampMs: string[] = [];

  @ApiProperty({
    description: 'The limit',
    example: 10,
  })
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}
