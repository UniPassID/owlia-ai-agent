import { Inject, Injectable, Logger } from '@nestjs/common';
import { User } from './entities/user.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  getUserResponseDto,
  UserDeploymentStatusDto,
  UserResponseDto,
} from './dto/user.response.dto';
import { toBytes } from 'viem';
import Safe, { PredictedSafeProps } from '@safe-global/protocol-kit';
import { getChainId, NetworkDto } from './dto/common.dto';
import { UserDeployment } from './entities/user-deployment.entity';
import blockchainsConfig from '../config/blockchains.config';
import { ConfigType } from '@nestjs/config';
import { DeploymentService } from '../deployment/deployment.service';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  private readonly rpcUrls: Record<number, string>;

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserDeployment)
    private userDeploymentRepository: Repository<UserDeployment>,
    private deploymentService: DeploymentService,
    @Inject(blockchainsConfig.KEY)
    blockchains: ConfigType<typeof blockchainsConfig>,
  ) {
    const bsc_rpc_url = blockchains.bsc.rpcUrl;
    const base_rpc_url = blockchains.base.rpcUrl;
    this.rpcUrls = {
      56: bsc_rpc_url,
      8453: base_rpc_url,
    };
  }

  async getUserInfo(owner: string): Promise<UserResponseDto> {
    const ownerBuffer = Buffer.from(toBytes(owner as `0x${string}`));
    const user = await this.userRepository.findOne({
      where: {
        owner: ownerBuffer,
      },
    });

    if (user) {
      const deployments = await this.userDeploymentRepository.find({
        where: {
          userId: user.id,
        },
      });
      return getUserResponseDto(user, deployments);
    } else {
      const deployments = await Promise.all(
        Object.entries(this.deploymentService.getDeploymentConfigs()).map(
          async ([network, deploymentConfig]) => {
            const networkDto = network as NetworkDto;
            const chainId = getChainId(networkDto);
            const safe = await this.getSafe(
              deploymentConfig.operator,
              owner,
              deploymentConfig.saltNonce,
              chainId,
            );
            const address = await safe.getAddress();
            return {
              id: null,
              userId: null,
              network: networkDto,
              address: address,
              status: UserDeploymentStatusDto.Uninitialized,
            };
          },
        ),
      );

      return {
        id: null,
        owner,
        deployments,
      };
    }
  }

  async getSafe(
    operator: string,
    owner: string,
    saltNonce: string,
    chainId: number,
  ): Promise<Safe> {
    const predictedSafe: PredictedSafeProps = {
      safeAccountConfig: {
        owners: [operator, owner],
        threshold: 1,
      },
      safeDeploymentConfig: {
        deploymentType: 'canonical',
        saltNonce,
        safeVersion: '1.4.1',
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

  //   async registerUser(
  //     network: NetworkDto,
  //     wallet: string,
  //     sig: string,
  //   ): Promise<UserResponseDto> {
  //     const chainId = getChainId(network);
  //     const walletBuffer = Buffer.from(ethers.getBytes(wallet));
  //     const user = await this.userRepository.findOne({
  //       where: {
  //         wallet: walletBuffer,
  //       },
  //     });
  //     if (user) {
  //       let deployments = await this.userV2DeploymentRepository.find({
  //         where: {
  //           userId: user.id,
  //         },
  //       });
  //       let chainDeploymentIndex = deployments.findIndex(
  //         (deployment) => deployment.chainId === chainId,
  //       );
  //       if (chainDeploymentIndex !== -1) {
  //         switch (deployments[chainDeploymentIndex].status) {
  //           case UserV2DeploymentStatus.uninitialized: {
  //             const deploymentConfig = DEPLOYMENT_CONFIGS[chainId];
  //             if (!deploymentConfig) {
  //               throw new HttpException(
  //                 `Unsupported chain: ${chainId}`,
  //                 HttpStatus.BAD_REQUEST,
  //               );
  //             }

  //             const safe = await this.getSafe(
  //               deploymentConfig.operator,
  //               wallet,
  //               chainId,
  //             );
  //             const transaction = await this.getSetGuardTransaction(
  //               deploymentConfig,
  //               safe,
  //             );
  //             const txHash = await safe.getTransactionHash(transaction);
  //             const isValid = await this.verifySignature(txHash, sig, wallet);
  //             if (!isValid) {
  //               this.logger.error('Invalid signature', txHash, sig, wallet);
  //               throw new HttpException(
  //                 'Invalid signature',
  //                 HttpStatus.BAD_REQUEST,
  //               );
  //             }

  //             deployments[chainDeploymentIndex].status =
  //               UserV2DeploymentStatus.init;
  //             deployments[chainDeploymentIndex].setGuardSignature = Buffer.from(
  //               ethers.getBytes(sig),
  //             );
  //             deployments[chainDeploymentIndex].updatedAt = new Date();
  //             await this.userV2DeploymentRepository.save(
  //               deployments[chainDeploymentIndex],
  //             );
  //             return getUserResponseDto(user, deployments);
  //           }
  //           case UserV2DeploymentStatus.init:
  //           case UserV2DeploymentStatus.setGuardSuccess:
  //             throw new HttpException(
  //               'User already registered',
  //               HttpStatus.BAD_REQUEST,
  //             );
  //         }
  //       } else {
  //         throw new HttpException(
  //           'Chain deployment not found',
  //           HttpStatus.BAD_REQUEST,
  //         );
  //       }
  //     }

  //     const now = new Date();
  //     const newUser = new UserV2();
  //     newUser.id = uuidV7();
  //     newUser.wallet = walletBuffer;
  //     newUser.createdAt = now;
  //     newUser.updatedAt = now;

  //     const deployments = await Promise.all(
  //       Object.entries(DEPLOYMENT_CONFIGS).map(
  //         async ([chainIdKey, deploymentConfig]) => {
  //           const chainIdNumber = Number(chainIdKey);
  //           if (chainIdNumber === chainId) {
  //             const safe = await this.getSafe(
  //               deploymentConfig.operator,
  //               wallet,
  //               chainId,
  //             );
  //             const address = await safe.getAddress();
  //             const transaction = await this.getSetGuardTransaction(
  //               deploymentConfig,
  //               safe,
  //             );
  //             const txHash = await safe.getTransactionHash(transaction);
  //             const isValid = await this.verifySignature(txHash, sig, wallet);
  //             if (!isValid) {
  //               this.logger.error('Invalid signature', txHash, sig, wallet);
  //               throw new HttpException(
  //                 'Invalid signature',
  //                 HttpStatus.BAD_REQUEST,
  //               );
  //             }

  //             const deployment = new UserV2Deployment();
  //             deployment.id = uuidV7();
  //             deployment.userId = newUser.id;
  //             deployment.chainId = chainIdNumber;
  //             deployment.address = Buffer.from(ethers.getBytes(address));
  //             deployment.operator = Buffer.from(
  //               ethers.getBytes(deploymentConfig.operator),
  //             );
  //             deployment.guard = Buffer.from(
  //               ethers.getBytes(deploymentConfig.guard),
  //             );
  //             deployment.setGuardSignature = Buffer.from(ethers.getBytes(sig));
  //             deployment.status = UserV2DeploymentStatus.init;
  //             deployment.createdAt = now;
  //             deployment.updatedAt = now;
  //             return deployment;
  //           } else {
  //             const safe = await this.getSafe(
  //               deploymentConfig.operator,
  //               wallet,
  //               chainId,
  //             );
  //             const address = await safe.getAddress();
  //             const deployment = new UserV2Deployment();
  //             deployment.id = uuidV7();
  //             deployment.userId = newUser.id;
  //             deployment.chainId = chainIdNumber;
  //             deployment.address = Buffer.from(ethers.getBytes(address));
  //             deployment.operator = Buffer.from(
  //               ethers.getBytes(deploymentConfig.operator),
  //             );
  //             deployment.guard = Buffer.from(
  //               ethers.getBytes(deploymentConfig.guard),
  //             );
  //             deployment.setGuardSignature = null;
  //             deployment.status = UserV2DeploymentStatus.uninitialized;
  //             deployment.createdAt = now;
  //             deployment.updatedAt = now;
  //             return deployment;
  //           }
  //         },
  //       ),
  //     );

  //     if (
  //       deployments.findIndex(
  //         (deployment) =>
  //           deployment.chainId === chainId &&
  //           deployment.status === UserV2DeploymentStatus.init,
  //       ) === -1
  //     ) {
  //       throw new HttpException('not support chain', HttpStatus.BAD_REQUEST);
  //     }

  //     const queryRunner = this.dataSource.createQueryRunner();
  //     await queryRunner.connect();
  //     await queryRunner.startTransaction();

  //     try {
  //       await queryRunner.manager.save(UserV2, newUser);
  //       for (const deployment of deployments) {
  //         await queryRunner.manager.save(UserV2Deployment, deployment);
  //       }
  //       await queryRunner.commitTransaction();
  //     } catch (error) {
  //       await queryRunner.rollbackTransaction();
  //       throw error;
  //     } finally {
  //       await queryRunner.release();
  //     }
  //     return getUserResponseDto(newUser, deployments);
  //   }

  //   async verifySignature(
  //     txHash: string,
  //     sig: string,
  //     wallet: string,
  //   ): Promise<boolean> {
  //     const newSig = new EthSafeSignature(wallet, sig);
  //     const staticPart = toBytes(newSig.staticPart());
  //     staticPart[64] = staticPart[64] - 4;
  //     try {
  //       const verifiedAddress = await recoverAddress({
  //         hash: keccak256(
  //           concat([
  //             toBytes('\x19Ethereum Signed Message:\n32'),
  //             toBytes(txHash as `0x${string}`),
  //           ]),
  //         ),
  //         signature: staticPart,
  //       });

  //       this.logger.log('Verified signature', verifiedAddress, wallet, txHash);
  //       return verifiedAddress.toLowerCase() === wallet.toLowerCase();
  //     } catch (error) {
  //       this.logger.error('Invalid signature', error, txHash);
  //       return false;
  //     }
  //   }

  //   async getWrappedDeploymentConfig(
  //     network: NetworkDto,
  //     wallet: string,
  //     sig: string,
  //   ) {
  //     const chainId = getChainId(network);
  //     const deploymentConfig = DEPLOYMENT_CONFIGS[chainId];
  //     if (!deploymentConfig) {
  //       throw new Error(`Unsupported chain: ${chainId}`);
  //     }
  //     const safe = await this.getSafe(deploymentConfig.operator, wallet, chainId);
  //     const tx = await this.getSetGuardTransaction(deploymentConfig, safe);
  //     tx.addSignature(new EthSafeSignature(wallet, sig));
  //     const data = await safe.getEncodedTransaction(tx);
  //     return {
  //       predictedSafe: safe.getPredictedSafe(),
  //       wrappedTx: [
  //         {
  //           to: await safe.getAddress(),
  //           data,
  //           value: '0',
  //         },
  //       ],
  //     };
  //   }

  //   async getSetGuardTransaction(
  //     deploymentConfig: DeploymentConfig,
  //     safe: Safe,
  //   ): Promise<EthSafeTransaction> {
  //     const address = await safe.getAddress();
  //     const setGuardTx = {
  //       to: address,
  //       data: encodeFunctionData({
  //         abi: SAFE_ABI,
  //         functionName: 'setGuard',
  //         args: [deploymentConfig.guard],
  //       }),
  //       value: '0',
  //     };

  //     const configurePoolTxs = deploymentConfig.pools.map((pool) => {
  //       switch (pool.type) {
  //         case 'uniswapV3':
  //           return {
  //             to: deploymentConfig.guard,
  //             data: encodeFunctionData({
  //               abi: GUARD_ABI,
  //               functionName: 'setUniswapV3PoolConfig',
  //               args: [
  //                 pool.token0,
  //                 pool.token1,
  //                 pool.fee,
  //                 pool.tickLower,
  //                 pool.tickUpper,
  //               ],
  //             }),
  //             value: '0',
  //           };
  //         case 'aerodromeSlipstream':
  //           return {
  //             to: deploymentConfig.guard,
  //             data: encodeFunctionData({
  //               abi: GUARD_ABI,
  //               functionName: 'setAerodromeCLPoolConfig',
  //               args: [
  //                 pool.token0,
  //                 pool.token1,
  //                 pool.tickSpacing,
  //                 pool.tickLower,
  //                 pool.tickUpper,
  //               ],
  //             }),
  //             value: '0',
  //           };
  //       }
  //     });

  //     const transaction = await safe.createTransaction({
  //       transactions: [setGuardTx, ...configurePoolTxs],
  //     });
  //     return transaction;
  //   }

  //   async getDeploymentByAddress(
  //     address: string,
  //     network: NetworkDto,
  //   ): Promise<UserV2Deployment | null> {
  //     const chainId = getChainId(network);
  //     const addressBuffer = Buffer.from(ethers.getBytes(address));
  //     const deployment = await this.userV2DeploymentRepository.findOne({
  //       where: {
  //         address: addressBuffer,
  //         chainId: chainId,
  //       },
  //     });
  //     return deployment;
  //   }
}
