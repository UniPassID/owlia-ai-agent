import { IsString, IsOptional, IsNumber, IsBoolean, IsArray } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdatePolicyDto {
  @ApiPropertyOptional({
    description: 'List of blockchain networks to monitor',
    example: ['ethereum', 'base'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  networks?: string[];

  @ApiPropertyOptional({
    description: 'Whitelist of allowed assets',
    example: ['USDC', 'USDT', 'DAI'],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  assetWhitelist?: string[];

  @ApiPropertyOptional({
    description: 'Minimum APR lift in basis points (1 bps = 0.01%)',
    example: 50,
  })
  @IsOptional()
  @IsNumber()
  minAprLiftBps?: number;

  @ApiPropertyOptional({
    description: 'Minimum net profit in USD for rebalance',
    example: 10,
  })
  @IsOptional()
  @IsNumber()
  minNetUsd?: number;

  @ApiPropertyOptional({
    description: 'Minimum health factor to maintain',
    example: 1.5,
  })
  @IsOptional()
  @IsNumber()
  minHealthFactor?: number;

  @ApiPropertyOptional({
    description: 'Maximum allowed slippage in basis points',
    example: 100,
  })
  @IsOptional()
  @IsNumber()
  maxSlippageBps?: number;

  @ApiPropertyOptional({
    description: 'Maximum gas cost in USD',
    example: 50,
  })
  @IsOptional()
  @IsNumber()
  maxGasUsd?: number;

  @ApiPropertyOptional({
    description: 'Maximum amount per trade in USD',
    example: 10000,
  })
  @IsOptional()
  @IsNumber()
  maxPerTradeUsd?: number;

  @ApiPropertyOptional({
    description: 'Enable automatic rebalancing',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  autoEnabled?: boolean;
}

export class TriggerRebalanceDto {
  @ApiProperty({
    description: 'User wallet address',
    example: '0x1234567890abcdef1234567890abcdef12345678',
  })
  @IsString()
  address: string;

  @ApiProperty({
    description: 'Blockchain network (name or chain ID)',
    example: 'base',
  })
  @IsString()
  network: string;

  @ApiPropertyOptional({
    description: 'Trigger reason',
    example: 'manual_trigger',
  })
  @IsOptional()
  @IsString()
  trigger?: string;
}

export class ExecuteJobDto {
  @ApiProperty({
    description: 'Rebalance job ID',
    example: '660e8400-e29b-41d4-a716-446655440001',
  })
  @IsString()
  jobId: string;
}
