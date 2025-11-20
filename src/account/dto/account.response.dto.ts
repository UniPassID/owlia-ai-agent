import { ApiProperty } from '@nestjs/swagger';
import { IsArray } from 'class-validator';
import { NetworkDto } from './common.dto';

export enum AccountDeploymentStatusDto {
  Uninitialized = 'uninitialized',
  PendingDeployment = 'pending_deployment',
  Deployed = 'deployed',
}

export class AccountDeploymentResponseDto {
  @ApiProperty({
    description: 'The ID of the account deployment',
    example: 'uuid',
  })
  id: string;

  @ApiProperty({
    description: 'The network of the account deployment',
    enum: NetworkDto,
    default: NetworkDto.Bsc,
  })
  network: NetworkDto;

  @ApiProperty({
    description: 'The address of the account deployment',
    example: '0x1234567890abcdef',
  })
  address: string;

  @ApiProperty({
    description: 'The status of the account deployment',
    enum: AccountDeploymentStatusDto,
    default: AccountDeploymentStatusDto.Uninitialized,
  })
  status: AccountDeploymentStatusDto;
}

export class AccountResponseDto {
  @ApiProperty({
    description: 'The ID of the account',
    example: 'uuid',
  })
  id: string;

  @ApiProperty({
    description: 'The wallet address of the account',
    example: '0x1234567890abcdef',
  })
  walletAddress: string;

  @ApiProperty({
    description: 'The deployments of the account',
    type: [AccountDeploymentResponseDto],
  })
  @IsArray()
  deployments: AccountDeploymentResponseDto[];
}
