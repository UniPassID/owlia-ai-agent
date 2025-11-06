import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ethers } from "ethers";
import {
  getChainId,
  getPoolConfigDtos,
  getUserResponseDto,
  NetworkDto,
  UserResponseDto,
  UserV2StatusDto,
} from "./dtos/user.dto";
import Safe, { PredictedSafeProps } from "@safe-global/protocol-kit";
import { UserV2, UserV2Status } from "../entities/user-v2.entity";
import { ConfigService } from "@nestjs/config";
import { v7 as uuidV7 } from "uuid";
import { encodeFunctionData } from "viem";
import { SAFE_ABI } from "./safe";
import { GUARD_ABI } from "./guard";

const SALT_NONCE =
  "0x47d3c7c3f44f7e04d88199ea908538d4c5c19fcc1826b351111da656bc5f2ead";

export const DEPLOYMENT_CONFIGS: Record<
  string,
  {
    operator: `0x${string}`;
    guard: `0x${string}`;
    pools: {
      type: "uniswapV3" | "aerodromeSlipstream";
      address: `0x${string}`;
      token0: `0x${string}`;
      token1: `0x${string}`;
      fee?: number;
      tickSpacing?: number;
      tickLower: number;
      tickUpper: number;
    }[];
  }
> = {
  56: {
    operator: "0x0fff18b2e7f2f0c45f4aed3872f6bab3d495c705",
    guard: "0xb19d7f88cc299e8f52e9ff4a497bb4305c2f154e",
    pools: [
      {
        type: "uniswapV3",
        address: "0xfDFc89d953e044f84faa2Ed4953190A066328ee0",
        token0: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        token1: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
        fee: 100,
        tickLower: -10,
        tickUpper: 10,
      },
      {
        type: "uniswapV3",
        address: "0xF150d29d92E7460a1531cbc9D1AbeAB33D6998e4",
        token0: "0x55d398326f99059fF775485246999027B3197955",
        token1: "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
        fee: 100,
        tickLower: -10,
        tickUpper: 10,
      },
      {
        type: "uniswapV3",
        address: "0x2C3c320D49019D4f9A92352e947c7e5AcFE47D68",
        token0: "0x55d398326f99059fF775485246999027B3197955",
        token1: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
        fee: 100,
        tickLower: -10,
        tickUpper: 10,
      },
    ],
  },
  8453: {
    operator: "0x0fff18b2e7f2f0c45f4aed3872f6bab3d495c705",
    guard: "0xf759577e7b5e51d8ab8f8da9a104d4d0c0f7f420",
    pools: [
      {
        type: "aerodromeSlipstream",
        address: "0xa41Bc0AFfbA7Fd420d186b84899d7ab2aC57fcD1",
        token0: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        token1: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
        tickSpacing: 1,
        tickLower: -10,
        tickUpper: 10,
      },
    ],
  },
};

export const CHAIN_ID_MAP: Record<string, number> = {
  ethereum: 1,
  eth: 1,
  mainnet: 1,
  "1": 1,
  bsc: 56,
  bnb: 56,
  "56": 56,
  optimism: 10,
  op: 10,
  "10": 10,
  base: 8453,
  "8453": 8453,
  arbitrum: 42161,
  arb: 42161,
  "42161": 42161,
};

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  private readonly rpcUrls: Record<number, string>;

  constructor(
    @InjectRepository(UserV2)
    private userRepository: Repository<UserV2>,
    @Inject(ConfigService)
    configService: ConfigService
  ) {
    const bsc_rpc_url = configService.getOrThrow("BSC_RPC_URL");
    const base_rpc_url = configService.getOrThrow("BASE_RPC_URL");
    this.rpcUrls = {
      56: bsc_rpc_url,
      8453: base_rpc_url,
    };
  }

  async getUserInfo(
    network: NetworkDto,
    wallet: string
  ): Promise<UserResponseDto> {
    const chainId = getChainId(network);
    const walletBuffer = Buffer.from(ethers.getBytes(wallet));
    const user = await this.userRepository.findOne({
      where: {
        chainId: Number(chainId),
        wallet: walletBuffer,
      },
    });

    if (user) {
      return getUserResponseDto(user);
    } else {
      const deploymentConfig = DEPLOYMENT_CONFIGS[chainId];
      if (!deploymentConfig) {
        throw new HttpException(
          `Unsupported chain: ${chainId}`,
          HttpStatus.BAD_REQUEST
        );
      }
      const safe = await this.getSafe(
        deploymentConfig.operator,
        wallet,
        chainId
      );
      const address = await safe.getAddress();
      return {
        id: null,
        network: network,
        wallet,
        address,
        operator: deploymentConfig.operator,
        guard: deploymentConfig.guard,
        status: UserV2StatusDto.notCreated,
        poolConfigs: getPoolConfigDtos(chainId),
      };
    }
  }

  async getSafe(
    operator: string,
    wallet: string,
    chainId: number
  ): Promise<Safe> {
    const predictedSafe: PredictedSafeProps = {
      safeAccountConfig: {
        owners: [operator, wallet],
        threshold: 1,
      },
      safeDeploymentConfig: {
        deploymentType: "canonical",
        saltNonce: SALT_NONCE,
      },
    };
    const rpcUrl = this.rpcUrls[chainId];
    if (!rpcUrl) {
      throw new Error(`Unsupported chain: ${chainId}`);
    }
    const protocolKit = await Safe.init({
      predictedSafe,
      provider: rpcUrl,
    });
    return protocolKit;
  }

  async registerUser(
    network: NetworkDto,
    wallet: string,
    sig: string
  ): Promise<UserResponseDto> {
    const chainId = getChainId(network);
    const walletBuffer = Buffer.from(ethers.getBytes(wallet));
    let user = await this.userRepository.findOne({
      where: {
        chainId,
        wallet: walletBuffer,
      },
    });
    if (user) {
      throw new HttpException(
        "User already registered",
        HttpStatus.BAD_REQUEST
      );
    }

    const deploymentConfig = DEPLOYMENT_CONFIGS[chainId];
    if (!deploymentConfig) {
      throw new HttpException(
        `Unsupported chain: ${chainId}`,
        HttpStatus.BAD_REQUEST
      );
    }

    const safe = await this.getSafe(deploymentConfig.operator, wallet, chainId);
    const address = await safe.getAddress();

    const setGuardTx = {
      to: address,
      data: encodeFunctionData({
        abi: SAFE_ABI,
        functionName: "setGuard",
        args: [deploymentConfig.guard],
      }),
      value: "0",
    };

    const configurePoolTxs = deploymentConfig.pools.map((pool) => {
      switch (pool.type) {
        case "uniswapV3":
          return {
            to: deploymentConfig.guard,
            data: encodeFunctionData({
              abi: GUARD_ABI,
              functionName: "setUniswapV3PoolConfig",
              args: [
                pool.token0,
                pool.token1,
                pool.fee,
                pool.tickLower,
                pool.tickUpper,
              ],
            }),
            value: "0",
          };
        case "aerodromeSlipstream":
          return {
            to: deploymentConfig.guard,
            data: encodeFunctionData({
              abi: GUARD_ABI,
              functionName: "setAerodromeCLPoolConfig",
              args: [
                pool.token0,
                pool.token1,
                pool.tickSpacing,
                pool.tickLower,
                pool.tickUpper,
              ],
            }),
            value: "0",
          };
      }
    });

    const transaction = await safe.createTransaction({
      transactions: [setGuardTx, ...configurePoolTxs],
    });

    const txHash = await safe.getTransactionHash(transaction);
    const isValid = await safe.isValidSignature(txHash, sig);
    if (!isValid) {
      throw new HttpException("Invalid signature", HttpStatus.BAD_REQUEST);
    }

    const now = new Date();
    let newUser = new UserV2();
    newUser.id = uuidV7();
    newUser.wallet = walletBuffer;
    newUser.address = Buffer.from(ethers.getBytes(address));
    newUser.operator = Buffer.from(ethers.getBytes(deploymentConfig.operator));
    newUser.guard = Buffer.from(ethers.getBytes(deploymentConfig.guard));
    newUser.setGuardSignature = Buffer.from(ethers.getBytes(sig));
    newUser.status = UserV2Status.init;
    newUser.createdAt = now;
    newUser.updatedAt = now;
    await this.userRepository.save(newUser);
    return getUserResponseDto(newUser);
  }
}
