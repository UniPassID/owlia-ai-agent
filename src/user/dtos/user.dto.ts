import { ethers } from "ethers";
import { UserV2, UserV2Status } from "../../entities/user-v2.entity";
import { DEPLOYMENT_CONFIGS } from "../user.service";
import { HttpException, HttpStatus } from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";

export enum UserV2StatusDto {
  notCreated = "not_created",
  init = "init",
  setGuardSuccess = "set_guard_success",
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

export class UserResponseDto {
  @ApiProperty()
  id: string | null;
  @ApiProperty()
  network: NetworkDto;
  @ApiProperty()
  wallet: string;
  @ApiProperty()
  owliaAddress: string;
  @ApiProperty()
  operator: string;
  @ApiProperty()
  guard: string;
  @ApiProperty({
    enum: UserV2StatusDto,
  })
  status: UserV2StatusDto;
  @ApiProperty()
  poolConfigs: PoolConfigDto[];
}

export function getUserV2StatusDto(status: number): UserV2StatusDto {
  switch (status) {
    case UserV2Status.init: {
      return UserV2StatusDto.init;
    }
    case UserV2Status.setGuardSuccess: {
      return UserV2StatusDto.setGuardSuccess;
    }
  }
}

export function getUserResponseDto(user: UserV2): UserResponseDto {
  return {
    id: user.id,
    network: getNetworkDto(user.chainId),
    wallet: ethers.hexlify(user.wallet),
    operator: ethers.hexlify(user.operator),
    guard: ethers.hexlify(user.guard),
    status: getUserV2StatusDto(user.status),
    owliaAddress: ethers.hexlify(user.address),
    poolConfigs: getPoolConfigDtos(user.chainId),
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
