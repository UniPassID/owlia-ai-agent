import { ApiProperty } from '@nestjs/swagger';
import { NetworkDto } from './common.dto';
import { IsArray } from 'class-validator';

export enum PositionProtocolDto {
  Idle = 'idle',
  UniswapV3 = 'uniswapV3',
  AerodromeCL = 'aerodromeCL',
  AaveV3 = 'aaveV3',
  EulerV2 = 'eulerV2',
  VenusV4 = 'venusV4',
}

export class PositionAssetResponseDto {
  @ApiProperty({
    description: 'The asset of the position',
    example: 'USDC',
  })
  symbol: string;

  @ApiProperty({
    description: 'The amount of the asset',
    example: '100.10',
  })
  amount: string;

  @ApiProperty({
    description: 'The underlying amount of the asset',
    example: '100.10',
  })
  underlyingAmount: string;

  @ApiProperty({
    description: 'The percentage of the asset',
    example: '10.10',
  })
  network: NetworkDto;

  @ApiProperty({
    description: 'The address of the asset',
    example: '0x1234567890abcdef',
  })
  address: string;
}

export class PositionResponseDto {
  @ApiProperty({
    description: 'The protocol of the position',
    enum: PositionProtocolDto,
    default: PositionProtocolDto.Idle,
  })
  protocol: PositionProtocolDto;

  @ApiProperty({
    description: 'The assets of the position',
    type: [PositionAssetResponseDto],
  })
  @IsArray()
  assets: PositionAssetResponseDto[];

  @ApiProperty({
    description: 'The unclaimed assets of the position',
    type: [PositionAssetResponseDto],
  })
  @IsArray()
  unclaimedAssets: PositionAssetResponseDto[];

  @ApiProperty({
    description: 'The underlying amount of the position',
    example: '100.10',
  })
  underlyingAmount: string;

  @ApiProperty({
    description: 'The APY rate of the position',
    example: '0.012',
  })
  apyRate: string;
}

export class PositionsResponseDto {
  @ApiProperty({
    description: 'The positions of the account',
    type: [PositionResponseDto],
  })
  @IsArray()
  positions: PositionResponseDto[];
}
