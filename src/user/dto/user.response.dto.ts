import { ApiProperty } from '@nestjs/swagger';
import { IsArray } from 'class-validator';
import { NetworkDto } from './common.dto';

export enum UserDeploymentStatusDto {
  Uninitialized = 'uninitialized',
  PendingDeployment = 'pending_deployment',
  Deployed = 'deployed',
}

export class UserDeploymentResponseDto {
  @ApiProperty({
    description: 'The ID of the user deployment',
    example: 'uuid',
  })
  id: string;

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

export class UserResponseDto {
  @ApiProperty({
    description: 'The ID of the user',
    example: 'uuid',
  })
  id: string;

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
