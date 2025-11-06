import { ethers } from "ethers";
import { UserV2, UserV2Status } from "../../entities/user-v2.entity";
import { DEPLOYMENT_CONFIGS } from "../user.service";
import { HttpException, HttpStatus } from "@nestjs/common";

export enum UserV2StatusDto {
  notCreated = "not_created",
  init = "init",
  setGuardSuccess = "set_guard_success",
}

export class PoolConfigDto {
  type: "uniswapV3" | "aerodromeSlipstream";
  address: string;
  token0: string;
  token1: string;
  fee?: number;
  tickSpacing?: number;
  tickLower: number;
  tickUpper: number;
}

export function getPoolConfigDtos(chainId: string): PoolConfigDto[] {
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

export class UserDto {
  id: string | null;
  chainId: string;
  wallet: string;
  address: string;
  operator: string;
  guard: string;
  status: UserV2StatusDto;
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

export function getUserDto(user: UserV2): UserDto {
  return {
    id: user.id,
    chainId: user.chainId.toString(),
    wallet: ethers.hexlify(user.wallet),
    operator: ethers.hexlify(user.operator),
    guard: ethers.hexlify(user.guard),
    status: getUserV2StatusDto(user.status),
    address: ethers.hexlify(user.address),
    poolConfigs: getPoolConfigDtos(user.chainId.toString()),
  };
}

export class RegisterUserDto {
  chainId: string;
  wallet: string;
  sig: string;
}
