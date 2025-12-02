import { ApiProperty } from '@nestjs/swagger';

export class EulerV2SubAccountResponseDto {
  @ApiProperty({
    description: 'The subAccount ID',
    example: 1,
  })
  subAccountId: number;
  @ApiProperty({
    description: 'The collateral value in USD',
    example: '100.10',
  })
  collateralValueUsd: string;
  @ApiProperty({
    description: 'The liability value in USD',
    example: '100.10',
  })
  liabilityValueUsd: string;
  @ApiProperty({
    description: 'The health score of the subAccount',
    example: '1.00',
  })
  healthScore: string;

  @ApiProperty({
    description: 'The net APY of the subAccount',
    example: '1.00',
  })
  netApy: string;
}

export class EulerV2LendingPositionResponseDto {
  @ApiProperty({
    description: 'The subAccount ID',
    example: 1,
  })
  subAccountId: number;
  @ApiProperty({
    description: 'The vault address',
    example: '0x1234567890abcdef',
  })
  vault: string;
  @ApiProperty({
    description: 'The underlying token address',
    example: '0x1234567890abcdef',
  })
  underlying: string;
  @ApiProperty({
    description: 'The debt token address',
    example: '0x1234567890abcdef',
  })
  debtToken: string;

  @ApiProperty({
    description: 'The supply amount',
    example: '1.00',
  })
  supplyAmount: string;
  @ApiProperty({
    description: 'The supply amount in USD',
    example: '1.00',
  })
  supplyAmountUsd: string;
  @ApiProperty({
    description: 'The supply APY',
    example: '1.00',
  })
  supplyApy: string;

  @ApiProperty({
    description: 'The borrow amount',
    example: '1.00',
  })
  borrowAmount: string;
  @ApiProperty({
    description: 'The borrow amount in USD',
    example: '1.00',
  })
  borrowAmountUsd: string;
  @ApiProperty({
    description: 'The borrow APY',
    example: '0.1',
  })
  borrowApy: string;

  @ApiProperty({
    description: 'The collateral factor',
    example: '0.1',
  })
  collateralFactor: string;
  @ApiProperty({
    description: 'The liquidation factor',
    example: '0.1',
  })
  liquidationFactor: string;
}

export class EulerV2ProtocolBlockResponseDto {
  @ApiProperty({
    description: 'The ID of the protocol block',
    example: 'euler-v2',
  })
  id: 'euler-v2';
  @ApiProperty({
    description: 'The name of the protocol',
    example: 'Euler',
  })
  name: 'Euler';
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
    description: 'The subAccounts of the protocol',
    type: [EulerV2SubAccountResponseDto],
  })
  subAccounts: EulerV2SubAccountResponseDto[];

  @ApiProperty({
    description: 'The lending positions of the protocol',
    type: [EulerV2LendingPositionResponseDto],
  })
  positions: EulerV2LendingPositionResponseDto[];
}
