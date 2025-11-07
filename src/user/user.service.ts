import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DataSource, QueryRunner, Repository } from "typeorm";
import { ethers } from "ethers";
import {
  getChainId,
  getNetworkDto,
  getPoolConfigDtos,
  getUserResponseDto,
  NetworkDto,
  UserResponseDto,
  UserV2DeploymentStatusDto,
} from "./dtos/user.dto";
import Safe, {
  EthSafeSignature,
  EthSafeTransaction,
  PredictedSafeProps,
} from "@safe-global/protocol-kit";
import { UserV2, UserV2Status } from "../entities/user-v2.entity";
import { ConfigService } from "@nestjs/config";
import { v7 as uuidV7 } from "uuid";
import {
  encodeFunctionData,
  fromBytes,
  recoverAddress,
  recoverMessageAddress,
  toBytes,
} from "viem";
import { SAFE_ABI } from "./safe";
import { GUARD_ABI } from "./guard";
import {
  UserV2Deployment,
  UserV2DeploymentStatus,
} from "../entities/user-v2-deployment.entity";

const SALT_NONCE =
  "0x47d3c7c3f44f7e04d88199ea908538d4c5c19fcc1826b351111da656bc5f2ead";

export type DeploymentConfig = {
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
};

export const DEPLOYMENT_CONFIGS: Record<string, DeploymentConfig> = {
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
    @InjectRepository(UserV2Deployment)
    private userV2DeploymentRepository: Repository<UserV2Deployment>,
    @Inject(ConfigService)
    configService: ConfigService,
    private readonly dataSource: DataSource
  ) {
    const bsc_rpc_url = configService.getOrThrow("BSC_RPC_URL");
    const base_rpc_url = configService.getOrThrow("BASE_RPC_URL");
    this.rpcUrls = {
      56: bsc_rpc_url,
      8453: base_rpc_url,
    };
  }

  async getUserInfo(wallet: string): Promise<UserResponseDto> {
    const walletBuffer = Buffer.from(ethers.getBytes(wallet));
    const user = await this.userRepository.findOne({
      where: {
        wallet: walletBuffer,
      },
    });

    if (user) {
      const deployments = await this.userV2DeploymentRepository.find({
        where: {
          userId: user.id,
        },
      });
      return getUserResponseDto(user, deployments);
    } else {
      const deployments = await Promise.all(
        Object.entries(DEPLOYMENT_CONFIGS).map(
          async ([chainId, deploymentConfig]) => {
            const chainIdNumber = Number(chainId);
            const safe = await this.getSafe(
              deploymentConfig.operator,
              wallet,
              chainIdNumber
            );
            const address = await safe.getAddress();
            return {
              id: null,
              userId: null,
              network: getNetworkDto(chainIdNumber),
              owliaAddress: address,
              operator: deploymentConfig.operator,
              guard: deploymentConfig.guard,
              status: UserV2DeploymentStatusDto.uninitialized,
              poolConfigs: getPoolConfigDtos(chainIdNumber),
            };
          }
        )
      );

      return {
        id: null,
        wallet,
        deployments,
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
        safeVersion: "1.4.1",
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
    const user = await this.userRepository.findOne({
      where: {
        wallet: walletBuffer,
      },
    });
    if (user) {
      let deployments = await this.userV2DeploymentRepository.find({
        where: {
          userId: user.id,
        },
      });
      let chainDeploymentIndex = deployments.findIndex(
        (deployment) => deployment.chainId === chainId
      );
      if (chainDeploymentIndex !== -1) {
        switch (deployments[chainDeploymentIndex].status) {
          case UserV2DeploymentStatus.uninitialized: {
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
            const transaction = await this.getSetGuardTransaction(
              deploymentConfig,
              safe
            );
            const txHash = await safe.getTransactionHash(transaction);
            const isValid = await this.verifySignature(txHash, sig, wallet);
            if (!isValid) {
              throw new HttpException(
                "Invalid signature",
                HttpStatus.BAD_REQUEST
              );
            }

            deployments[chainDeploymentIndex].status =
              UserV2DeploymentStatus.init;
            deployments[chainDeploymentIndex].setGuardSignature = Buffer.from(
              ethers.getBytes(sig)
            );
            deployments[chainDeploymentIndex].updatedAt = new Date();
            await this.userV2DeploymentRepository.save(
              deployments[chainDeploymentIndex]
            );
            return getUserResponseDto(user, deployments);
          }
          case UserV2DeploymentStatus.init:
          case UserV2DeploymentStatus.setGuardSuccess:
            throw new HttpException(
              "User already registered",
              HttpStatus.BAD_REQUEST
            );
        }
      } else {
        throw new HttpException(
          "Chain deployment not found",
          HttpStatus.BAD_REQUEST
        );
      }
    }

    const now = new Date();
    const newUser = new UserV2();
    newUser.id = uuidV7();
    newUser.wallet = walletBuffer;
    newUser.createdAt = now;
    newUser.updatedAt = now;

    const deployments = await Promise.all(
      Object.entries(DEPLOYMENT_CONFIGS).map(
        async ([chainIdKey, deploymentConfig]) => {
          const chainIdNumber = Number(chainIdKey);
          if (chainIdNumber === chainId) {
            const safe = await this.getSafe(
              deploymentConfig.operator,
              wallet,
              chainId
            );
            const address = await safe.getAddress();
            const transaction = await this.getSetGuardTransaction(
              deploymentConfig,
              safe
            );
            const txHash = await safe.getTransactionHash(transaction);
            const isValid = await this.verifySignature(txHash, sig, wallet);
            if (!isValid) {
              throw new HttpException(
                "Invalid signature",
                HttpStatus.BAD_REQUEST
              );
            }

            const deployment = new UserV2Deployment();
            deployment.id = uuidV7();
            deployment.userId = newUser.id;
            deployment.chainId = chainIdNumber;
            deployment.address = Buffer.from(ethers.getBytes(address));
            deployment.operator = Buffer.from(
              ethers.getBytes(deploymentConfig.operator)
            );
            deployment.guard = Buffer.from(
              ethers.getBytes(deploymentConfig.guard)
            );
            deployment.setGuardSignature = Buffer.from(ethers.getBytes(sig));
            deployment.status = UserV2DeploymentStatus.init;
            deployment.createdAt = now;
            deployment.updatedAt = now;
            return deployment;
          }
        }
      )
    );

    if (
      deployments.findIndex(
        (deployment) =>
          deployment.chainId === chainId &&
          deployment.status === UserV2DeploymentStatus.init
      ) === -1
    ) {
      throw new HttpException("not support chain", HttpStatus.BAD_REQUEST);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.save(UserV2, newUser);
      for (const deployment of deployments) {
        await queryRunner.manager.save(UserV2Deployment, deployment);
      }
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
    return getUserResponseDto(newUser, deployments);
  }

  async verifySignature(
    txHash: string,
    sig: string,
    wallet: string
  ): Promise<boolean> {
    const newSig = new EthSafeSignature(wallet, sig);
    const staticPart = toBytes(newSig.staticPart());
    staticPart[64] = staticPart[64] - 4;
    try {
      const verifiedAddress = await recoverMessageAddress({
        message: txHash as `0x${string}`,
        signature: staticPart,
      });
      return verifiedAddress.toLowerCase() === wallet.toLowerCase();
    } catch (error) {
      this.logger.error("Invalid signature", error, txHash);
      return false;
    }
  }

  async getSetGuardTransaction(
    deploymentConfig: DeploymentConfig,
    safe: Safe
  ): Promise<EthSafeTransaction> {
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
    return transaction;
  }
}
