import { ApiProperty } from '@nestjs/swagger';

export class AerodromeCLPositionResponseDto {
  @ApiProperty({
    description: 'The pool address of the position',
    example: '0x1234567890abcdef',
  })
  poolAddress: string;
  @ApiProperty({
    description: 'The token0 of the position',
    example: '0x1234567890abcdef',
  })
  token0: string;
  @ApiProperty({
    description: 'The token1 of the position',
    example: '0x1234567890abcdef',
  })
  token1: string;
  @ApiProperty({
    description: 'The fee of the position',
    example: '1.00',
  })
  fee: string;
  @ApiProperty({
    description: 'The tick spacing of the position',
    example: '1.00',
  })
  tickSpacing: string;
  @ApiProperty({
    description: 'The tick lower of the position',
    example: '1.00',
  })
  tickLower: string;
  @ApiProperty({
    description: 'The tick upper of the position',
    example: '1.00',
  })
  tickUpper: string;
  @ApiProperty({
    description: 'The liquidity of the position',
    example: '1.00',
  })
  liquidity: string;
  @ApiProperty({
    description: 'The token ID of the position',
    example: '1.00',
  })
  tokenId: string;
  @ApiProperty({
    description: 'The amount0 of the position',
    example: '1.00',
  })
  amount0: string;
  @ApiProperty({
    description: 'The amount1 of the position',
    example: '1.00',
  })
  amount1: string;
  @ApiProperty({
    description: 'The amount0 USD of the position',
    example: '1.00',
  })
  amount0Usd: string;
  @ApiProperty({
    description: 'The amount1 USD of the position',
    example: '1.00',
  })
  amount1Usd: string;
  @ApiProperty({
    description: 'The position USD of the position',
    example: '1.00',
  })
  positionUsd: string;
  @ApiProperty({
    description: 'The tokens owed0 of the position',
    example: '1.00',
  })
  tokensOwed0: string;
  @ApiProperty({
    description: 'The tokens owed1 of the position',
    example: '1.00',
  })
  tokensOwed1: string;
  @ApiProperty({
    description: 'The tokens owed0 USD of the position',
    example: '1.00',
  })
  tokensOwed0Usd: string;
  @ApiProperty({
    description: 'The tokens owed1 USD of the position',
    example: '1.00',
  })
  tokensOwed1Usd: string;
  @ApiProperty({
    description: 'The APY of the position',
    example: '1.00',
  })
  apy: string;
}

export class AerodromeCLProtocolBlockResponseDto {
  @ApiProperty({
    description: 'The ID of the protocol block',
    example: 'aerodrome-cl',
  })
  id: 'aerodrome-cl';
  @ApiProperty({
    description: 'The name of the protocol',
    example: 'Aerodrome',
  })
  name: 'Aerodrome';
  @ApiProperty({
    description: 'The version of the protocol',
    example: 'v2',
  })
  version: 'v2';

  @ApiProperty({
    description: 'The asset USD of the protocol',
    example: '100.10',
  })
  assetUsd: string;
  @ApiProperty({
    description: 'The debt USD of the protocol',
    example: '100.10',
  })
  debtUsd: string;
  @ApiProperty({
    description: 'The net USD of the protocol',
    example: '100.10',
  })
  netUsd: string;
  @ApiProperty({
    description: 'The claimable USD of the protocol',
    example: '100.10',
  })
  claimableUsd: string;

  @ApiProperty({
    description: 'The positions of the protocol',
    type: [AerodromeCLPositionResponseDto],
  })
  positions: AerodromeCLPositionResponseDto[];
}
