import { ApiProperty } from '@nestjs/swagger';
import { IsArray } from 'class-validator';
import { getNetworkDto, NetworkDto } from './common.dto';
import { User } from '../entities/user.entity';
import {
  UserDeployment,
  UserDeploymentStatus,
} from '../entities/user-deployment.entity';
import uuid from 'uuid';
import { fromBytes } from 'viem';
import Safe from '@safe-global/protocol-kit';

export enum UserDeploymentStatusDto {
  Uninitialized = 'uninitialized',
  PendingDeployment = 'pending_deployment',
  Deployed = 'deployed',
}

export function getUserDeploymentStatusDto(
  status: UserDeploymentStatus,
): UserDeploymentStatusDto {
  switch (status) {
    case UserDeploymentStatus.Uninitialized:
      return UserDeploymentStatusDto.Uninitialized;
    case UserDeploymentStatus.PendingDeployment:
      return UserDeploymentStatusDto.PendingDeployment;
    case UserDeploymentStatus.Deployed:
      return UserDeploymentStatusDto.Deployed;
  }
}

export class UserDeploymentResponseDto {
  @ApiProperty({
    description: 'The ID of the user deployment',
    example: 'uuid',
  })
  id: string | null;

  @ApiProperty({
    description: 'The network of the user deployment',
    enum: NetworkDto,
    default: NetworkDto.Bsc,
  })
  network: NetworkDto;

  @ApiProperty({
    description: 'The address of the user deployment',
    example: '0x1234567890abcdef',
  })
  address: string;

  @ApiProperty({
    description: 'The status of the user deployment',
    enum: UserDeploymentStatusDto,
    default: UserDeploymentStatusDto.Uninitialized,
  })
  status: UserDeploymentStatusDto;
}

export function getUserDeploymentResponseDto(
  deployment: UserDeployment,
): UserDeploymentResponseDto {
  return {
    id: uuid.stringify(deployment.id),
    network: getNetworkDto(deployment.chainId),
    address: fromBytes(deployment.address, 'hex'),
    status: getUserDeploymentStatusDto(deployment.status),
  };
}

export async function getUninitializedUserDeploymentResponseDto(
  safe: Safe,
  chainId: number,
): Promise<UserDeploymentResponseDto> {
  const address = await safe.getAddress();
  return {
    id: null,
    network: getNetworkDto(chainId),
    address,
    status: UserDeploymentStatusDto.Uninitialized,
  };
}

export class UserResponseDto {
  @ApiProperty({
    description: 'The ID of the user',
    example: 'uuid',
  })
  id: string | null;

  @ApiProperty({
    description: 'The owner of the user',
    example: '0x1234567890abcdef',
  })
  owner: string;

  @ApiProperty({
    description: 'The deployments of the user',
    type: [UserDeploymentResponseDto],
  })
  @IsArray()
  deployments: UserDeploymentResponseDto[];
}

export function getUserResponseDto(
  user: User,
  deployments: UserDeployment[],
): UserResponseDto {
  return {
    id: uuid.stringify(user.id),
    owner: fromBytes(user.owner, 'hex'),
    deployments: deployments.map((deployment) =>
      getUserDeploymentResponseDto(deployment),
    ),
  };
}
