import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { IsArray } from 'class-validator';
import { getNetworkDto, NetworkDto } from './common.dto';
import { User } from '../entities/user.entity';
import {
  UserDeployment,
  UserDeploymentStatus,
} from '../entities/user-deployment.entity';
import { stringify as uuidStringify } from 'uuid';
import { fromBytes } from 'viem';
import Safe from '@safe-global/protocol-kit';
import {
  DeploymentConfigResponseDto,
  ValidatorAaveV3ResponseDto,
  ValidatorAerodromeCLResponseDto,
  ValidatorEulerV2ResponseDto,
  ValidatorKyberSwapResponseDto,
  ValidatorResponseDto,
  ValidatorUniswapV3ResponseDto,
  ValidatorVenusV4ResponseDto,
} from '../../deployment/dto/deployment.response.dto';
import { toValidatorResponseDto } from './register-user.dto';

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

@ApiExtraModels(
  ValidatorUniswapV3ResponseDto,
  ValidatorAerodromeCLResponseDto,
  ValidatorAaveV3ResponseDto,
  ValidatorEulerV2ResponseDto,
  ValidatorVenusV4ResponseDto,
  ValidatorKyberSwapResponseDto,
)
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

  @ApiProperty({
    description: 'The validators of the user deployment',
    nullable: true,
    oneOf: [
      { $ref: getSchemaPath(ValidatorUniswapV3ResponseDto) },
      { $ref: getSchemaPath(ValidatorAerodromeCLResponseDto) },
      { $ref: getSchemaPath(ValidatorAaveV3ResponseDto) },
      { $ref: getSchemaPath(ValidatorEulerV2ResponseDto) },
      { $ref: getSchemaPath(ValidatorVenusV4ResponseDto) },
      { $ref: getSchemaPath(ValidatorKyberSwapResponseDto) },
    ],
  })
  validators: ValidatorResponseDto[] | null;
}

export function getUserDeploymentResponseDto(
  deployment: UserDeployment,
  validatorResponses: DeploymentConfigResponseDto,
): UserDeploymentResponseDto {
  return {
    id: uuidStringify(deployment.id),
    network: getNetworkDto(deployment.chainId),
    address: fromBytes(deployment.address, 'hex'),
    status: getUserDeploymentStatusDto(deployment.status),
    validators: deployment.validators
      ? toValidatorResponseDto(
          getNetworkDto(deployment.chainId),
          deployment.validators,
          validatorResponses.validators,
        )
      : null,
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
    validators: null,
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
  validatorResponses: Record<NetworkDto, DeploymentConfigResponseDto>,
): UserResponseDto {
  return {
    id: uuidStringify(user.id),
    owner: fromBytes(user.owner, 'hex'),
    deployments: deployments.map((deployment) => {
      const network = getNetworkDto(deployment.chainId);
      const validatorResponsesForNetwork = validatorResponses[network];
      return getUserDeploymentResponseDto(
        deployment,
        validatorResponsesForNetwork,
      );
    }),
  };
}

export function getUninitializedUserResponseDto(
  owner: string,
  deployments: UserDeploymentResponseDto[],
): UserResponseDto {
  return {
    id: null,
    owner,
    deployments,
  };
}
