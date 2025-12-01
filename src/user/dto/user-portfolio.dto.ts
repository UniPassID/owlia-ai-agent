import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NetworkDto } from '../../common/dto/network.dto';
import { Address } from '../../common/decorators/address.decorator';
import { IsArray, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UserPortfolioRequestDto {
  @ApiProperty({
    description: 'The network of the user portfolio',
    enum: NetworkDto,
  })
  network: NetworkDto;

  @ApiProperty({
    description: 'The address of the user portfolio',
    example: '0x1234567890abcdef',
  })
  @Address()
  address: string;
}

export class UserPortfoliosRequestDto {
  @ApiProperty({
    description: 'The network of the user portfolio',
    enum: NetworkDto,
  })
  network: NetworkDto;

  @ApiProperty({
    description: 'The address of the user portfolio',
    example: '0x1234567890abcdef',
  })
  @Address()
  address: string;

  @ApiPropertyOptional({
    description: 'The snap time of the user portfolio',
    example: '2021-01-01T00:00:00.000Z',
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
