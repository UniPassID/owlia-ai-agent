import { IsString, IsOptional, IsNumber, IsBoolean, IsArray } from 'class-validator';

export class UpdatePolicyDto {
  @IsOptional()
  @IsArray()
  chains?: string[];

  @IsOptional()
  @IsArray()
  assetWhitelist?: string[];

  @IsOptional()
  @IsNumber()
  minAprLiftBps?: number;

  @IsOptional()
  @IsNumber()
  minNetUsd?: number;

  @IsOptional()
  @IsNumber()
  minHealthFactor?: number;

  @IsOptional()
  @IsNumber()
  maxSlippageBps?: number;

  @IsOptional()
  @IsNumber()
  maxGasUsd?: number;

  @IsOptional()
  @IsNumber()
  maxPerTradeUsd?: number;

  @IsOptional()
  @IsBoolean()
  autoEnabled?: boolean;
}

export class TriggerRebalanceDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  trigger?: string;
}

export class ExecuteJobDto {
  @IsString()
  jobId: string;
}
