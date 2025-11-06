import { ethers } from "ethers";
import { UserV2, UserV2Status } from "../../entities/user-v2.entity";
import { DEPLOYMENT_CONFIGS } from "../user.service";
import { HttpException, HttpStatus } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import {
  UserV2Deployment,
  UserV2DeploymentStatus,
} from "../../entities/user-v2-deployment.entity";

export enum UserV2DeploymentStatusDto {
  uninitialized = "uninitialized",
  pendingDeployment = "pending_deployment",
  deployed = "deployed",
}

export enum NetworkDto {
  bsc = "bsc",
  base = "base",
}

export function getChainId(network: NetworkDto): number {
  switch (network) {
    case NetworkDto.bsc:
      return 56;
    case NetworkDto.base:
      return 8453;
    default:
      throw new HttpException(
        `Unsupported network: ${network}`,
        HttpStatus.BAD_REQUEST
      );
  }
}

export function getNetworkDto(chainId: number): NetworkDto {
  switch (chainId) {
    case 56:
      return NetworkDto.bsc;
    case 8453:
      return NetworkDto.base;
    default:
      throw new HttpException(
        `Unsupported chain: ${chainId}`,
        HttpStatus.BAD_REQUEST
      );
  }
}

export class PoolConfigDto {
  @ApiProperty()
  type: "uniswapV3" | "aerodromeSlipstream";
  @ApiProperty()
  address: string;
  @ApiProperty()
  token0: string;
  @ApiProperty()
  token1: string;
  @ApiProperty()
  fee?: number;
  @ApiProperty()
  tickSpacing?: number;
  @ApiProperty()
  tickLower: number;
  @ApiProperty()
  tickUpper: number;
}

export function getPoolConfigDtos(chainId: number): PoolConfigDto[] {
  const deploymentConfig = DEPLOYMENT_CONFIGS[chainId];
  if (!deploymentConfig) {
    throw new HttpException(
      `Unsupported chain: ${chainId}`,
      HttpStatus.BAD_REQUEST
    );
  }
  return deploymentConfig.pools.map((pool) => ({
    type: pool.type,
    address: ethers.hexlify(pool.address),
    token0: ethers.hexlify(pool.token0),
    token1: ethers.hexlify(pool.token1),
    fee: pool.fee,
    tickSpacing: pool.tickSpacing,
    tickLower: pool.tickLower,
    tickUpper: pool.tickUpper,
  }));
}

export class UserV2DeploymentResponseDto {
  @ApiProperty()
  id: string;
  @ApiProperty()
  network: NetworkDto;
  @ApiProperty()
  userId: string | null;
  @ApiProperty()
  owliaAddress: string;
  @ApiProperty()
  operator: string;
  @ApiProperty()
  guard: string;
  @ApiProperty({
    enum: UserV2DeploymentStatusDto,
  })
  status: UserV2DeploymentStatusDto;
  @ApiProperty()
  poolConfigs: PoolConfigDto[];
}

export function getUserV2DeploymentResponseDto(
  deployment: UserV2Deployment
): UserV2DeploymentResponseDto {
  return {
    id: deployment.id,
    userId: deployment.userId,
    network: getNetworkDto(deployment.chainId),
    owliaAddress: ethers.hexlify(deployment.address),
    operator: ethers.hexlify(deployment.operator),
    guard: ethers.hexlify(deployment.guard),
    status: getUserV2DeploymentStatusDto(deployment.status),
    poolConfigs: getPoolConfigDtos(deployment.chainId),
  };
}

export class UserResponseDto {
  @ApiProperty()
  id: string | null;
  @ApiProperty()
  wallet: string;
  @ApiProperty({
    type: [UserV2DeploymentResponseDto],
    isArray: true,
  })
  deployments: UserV2DeploymentResponseDto[];
}

export function getUserV2DeploymentStatusDto(
  status: UserV2DeploymentStatus
): UserV2DeploymentStatusDto {
  switch (status) {
    case UserV2DeploymentStatus.uninitialized: {
      return UserV2DeploymentStatusDto.uninitialized;
    }
    case UserV2DeploymentStatus.init: {
      return UserV2DeploymentStatusDto.pendingDeployment;
    }
    case UserV2DeploymentStatus.setGuardSuccess: {
      return UserV2DeploymentStatusDto.deployed;
    }
  }
}

export function getUserResponseDto(
  user: UserV2,
  deployments: UserV2Deployment[]
): UserResponseDto {
  return {
    id: user.id,
    wallet: ethers.hexlify(user.wallet),
    deployments: deployments.map((deployment) =>
      getUserV2DeploymentResponseDto(deployment)
    ),
  };
}

export class RegisterUserRequestDto {
  @ApiProperty()
  network: NetworkDto;
  @ApiProperty()
  wallet: string;
  @ApiProperty()
  sig: string;
}
