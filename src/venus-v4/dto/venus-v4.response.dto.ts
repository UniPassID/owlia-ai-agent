import { ApiProperty } from '@nestjs/swagger';

export class VenusV4SupplyResponseDto {
  @ApiProperty({
    description: 'The token address of the supply',
    example: '0x1234567890abcdef',
  })
  tokenAddress: string;
  @ApiProperty({
    description: 'The amount of the supply',
    example: '1.00',
  })
  amount: string;
  @ApiProperty({
    description: 'The amount in USD of the supply',
    example: '1.00',
  })
  amountUsd: string;
  @ApiProperty({
    description: 'The supply APY of the supply',
    example: '1.00',
  })
  supplyApy: string;
  @ApiProperty({
    description:
      'Whether the supplied asset is enabled as collateral. When true, the asset can be used as collateral to borrow other assets. When false, the asset only earns supply APY but cannot be used for borrowing.',
    example: true,
  })
  usageAsCollateralEnabled: boolean;
}

export class VenusV4BorrowResponseDto {
  @ApiProperty({
    description: 'The token address of the borrow',
    example: '0x1234567890abcdef',
  })
  tokenAddress: string;
  @ApiProperty({
    description: 'The amount of the borrow',
    example: '1.00',
  })
  amount: string;
  @ApiProperty({
    description: 'The amount in USD of the borrow',
    example: '1.00',
  })
  amountUsd: string;
  @ApiProperty({
    description: 'The borrow APY of the borrow',
    example: '1.00',
  })
  borrowApy: string;
}

export class VenusV4RewardsResponseDto {
  @ApiProperty({
    description: 'The token address of the reward',
    example: '0x1234567890abcdef',
  })
  tokenAddress: string;
  @ApiProperty({
    description: 'The amount of the reward',
    example: '1.00',
  })
  amount: string;
  @ApiProperty({
    description: 'The amount in USD of the reward',
    example: '1.00',
  })
  amountUsd: string;
  @ApiProperty({
    description: 'The reward APY of the reward',
    example: '1.00',
  })
  rewardApy: string;
}

export class VenusV4ProtocolBlockResponseDto {
  @ApiProperty({
    description: 'The ID of the protocol block',
    example: 'venus-v4',
  })
  id: 'venus-v4';
  @ApiProperty({
    description: 'The name of the protocol',
    example: 'Venus',
  })
  name: 'Venus';
  @ApiProperty({
    description: 'The version of the protocol',
    example: 'v4',
  })
  version: 'v4';

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
    description: 'The total collateral USD of the protocol',
    example: '100.10',
  })
  totalCollateralUsd: string;
  @ApiProperty({
    description: 'The total debt USD of the protocol',
    example: '100.10',
  })
  totalDebtUsd: string;
  @ApiProperty({
    description: 'The health factor of the protocol',
    example: '1.00',
  })
  healthFactor: string;
  @ApiProperty({
    description: 'The LTV of the protocol',
    example: '1.00',
  })
  ltv: string;
  @ApiProperty({
    description: 'The liquidation threshold of the protocol',
    example: '1.00',
  })
  liquidationThreshold: string;
  @ApiProperty({
    description: 'The net APY of the protocol',
    example: '1.00',
  })
  netApy: string;

  @ApiProperty({
    description: 'The supplied assets of the protocol',
    type: [VenusV4SupplyResponseDto],
  })
  supplied: VenusV4SupplyResponseDto[];
  @ApiProperty({
    description: 'The borrowed assets of the protocol',
    type: [VenusV4BorrowResponseDto],
  })
  borrowed: VenusV4BorrowResponseDto[];
  @ApiProperty({
    description: 'The rewards of the protocol',
    type: [VenusV4RewardsResponseDto],
  })
  rewards: VenusV4RewardsResponseDto[];
}
