import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Safe, {
  EthSafeSignature,
  EthSafeTransaction,
  generateTypedData,
  PredictedSafeProps,
} from '@safe-global/protocol-kit';
import { DataSource, Repository } from 'typeorm';
import { parse as uuidParse, v7 as uuidV7 } from 'uuid';
import { encodeFunctionData, toBytes, verifyTypedData } from 'viem';

import {
  InvalidSignatureException,
  NetworkNotSupportedException,
  UserAlreadyRegisteredException,
  ValidatorNotSupportedException,
} from '../common/exceptions/base.exception';
import blockchainsConfig from '../config/blockchains.config';
import { DeploymentService } from '../deployment/deployment.service';
import {
  DeploymentConfigResponseDto,
  ValidatorTypeDto,
} from '../deployment/dto/deployment.response.dto';
import { AAVE_V3_OWLIA_VALIDATOR_ABI } from './abis/aave-v3-owlia-validator.abi';
import { EULER_V2_OWLIA_VALIDATOR_ABI } from './abis/euler-v2-owlia-validator.abi';
import { KYBER_SWAP_OWLIA_VALIDATOR_ABI } from './abis/kyber-swap-owlia-validator.abi';
import { OWLIA_GUARD_ABI } from './abis/owlia-guard.abi';
import { SAFE_ABI } from './abis/safe.abi';
import { UNISWAP_V3_OWLIA_VALIDATOR_ABI } from './abis/uniswap-v3-owlia-validator.abi';
import { VENUS_V4_OWLIA_VALIDATOR_ABI } from './abis/venus-v4-owlia-validator.abi';
import { VALIDATOR_CONFIGS, ValidatorConfig } from './constants';
import { getChainId, NetworkDto } from './dto/common.dto';
import { toValidatorResponseDto, ValidatorDto } from './dto/register-user.dto';
import {
  getUninitializedUserDeploymentResponseDto,
  getUninitializedUserResponseDto,
  getUserResponseDto,
  UserResponseDto,
} from './dto/user.response.dto';
import { User } from './entities/user.entity';
import {
  UserDeployment,
  UserDeploymentStatus,
} from './entities/user-deployment.entity';
import {
  EIP712TypedDataMessage,
  EIP712TypedDataTx,
  SafeEIP712Args,
} from '@safe-global/types-kit';

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
    private dataSource: DataSource,
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
    const deploymentConfigs = this.deploymentService.getDeploymentConfigs();

    if (user) {
      const deployments = await this.userDeploymentRepository.find({
        where: {
          userId: user.id,
        },
      });
      return getUserResponseDto(user, deployments, deploymentConfigs);
    } else {
      const deployments = await Promise.all(
        Object.entries(deploymentConfigs).map(
          async ([network, deploymentConfig]) => {
            const networkDto = network as NetworkDto;
            const chainId = getChainId(networkDto);
            const safe = await this.getSafe(
              deploymentConfig.operator,
              owner,
              deploymentConfig.saltNonce,
              chainId,
            );
            return getUninitializedUserDeploymentResponseDto(safe, chainId);
          },
        ),
      );

      return getUninitializedUserResponseDto(owner, deployments);
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

  async registerUser(
    network: NetworkDto,
    owner: string,
    validators: ValidatorDto[],
    signature: string,
  ): Promise<UserResponseDto> {
    const chainId = getChainId(network);
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
      const chainDeploymentIndex = deployments.findIndex(
        (deployment) => deployment.chainId === chainId,
      );
      if (chainDeploymentIndex !== -1) {
        switch (deployments[chainDeploymentIndex].status) {
          case UserDeploymentStatus.Uninitialized: {
            const deploymentConfig =
              this.deploymentService.getDeploymentConfig(network);
            if (!deploymentConfig) {
              throw new NetworkNotSupportedException(network);
            }

            deploymentConfig.validators = toValidatorResponseDto(
              network,
              validators,
              deploymentConfig.validators,
            );

            const validatorConfigs = VALIDATOR_CONFIGS[network];
            if (!validatorConfigs) {
              throw new NetworkNotSupportedException(network);
            }

            const safe = await this.getSafe(
              deploymentConfig.operator,
              owner,
              deploymentConfig.saltNonce,
              chainId,
            );
            const transaction = await this.getSetGuardTransaction(
              network,
              deploymentConfig,
              validatorConfigs,
              safe,
            );
            const isValid = await this.verifySignature(
              owner,
              safe,
              transaction,
              signature,
            );
            if (!isValid) {
              throw new InvalidSignatureException();
            }

            deployments[chainDeploymentIndex].status =
              UserDeploymentStatus.PendingDeployment;
            deployments[chainDeploymentIndex].setGuardSignature = Buffer.from(
              toBytes(signature),
            );
            deployments[chainDeploymentIndex].updatedAt = new Date();
            await this.userDeploymentRepository.save(
              deployments[chainDeploymentIndex],
            );
            return getUserResponseDto(user, deployments, {
              [network]: deploymentConfig,
            } as Record<NetworkDto, DeploymentConfigResponseDto>);
          }
          case UserDeploymentStatus.PendingDeployment:
          case UserDeploymentStatus.Deployed:
            throw new UserAlreadyRegisteredException(owner);
        }
      } else {
        throw new NetworkNotSupportedException(network);
      }
    }

    const now = new Date();
    const newUser = new User();
    newUser.id = Buffer.from(uuidParse(uuidV7()));
    newUser.owner = ownerBuffer;
    newUser.createdAt = now;
    newUser.updatedAt = now;

    const deploymentConfigs = this.deploymentService.getDeploymentConfigs();

    const validatorConfigs = VALIDATOR_CONFIGS[network];
    if (!validatorConfigs) {
      throw new NetworkNotSupportedException(network);
    }
    const deployments = await Promise.all(
      Object.entries(deploymentConfigs).map(
        async ([network, deploymentConfig]) => {
          const networkDto = network as NetworkDto;
          const currentChainId = getChainId(networkDto);
          if (currentChainId === chainId) {
            deploymentConfig.validators = toValidatorResponseDto(
              networkDto,
              validators,
              deploymentConfig.validators,
            );
            const safe = await this.getSafe(
              deploymentConfig.operator,
              owner,
              deploymentConfig.saltNonce,
              currentChainId,
            );
            const address = await safe.getAddress();
            const transaction = await this.getSetGuardTransaction(
              networkDto,
              deploymentConfig,
              validatorConfigs,
              safe,
            );
            const isValid = await this.verifySignature(
              owner,
              safe,
              transaction,
              signature,
            );
            if (!isValid) {
              throw new InvalidSignatureException();
            }

            const deployment = new UserDeployment();
            deployment.id = Buffer.from(uuidParse(uuidV7()));
            deployment.userId = newUser.id;
            deployment.chainId = currentChainId;
            deployment.address = Buffer.from(toBytes(address as `0x${string}`));
            deployment.operator = Buffer.from(
              toBytes(deploymentConfig.operator as `0x${string}`),
            );
            deployment.guard = Buffer.from(
              toBytes(deploymentConfig.guard as `0x${string}`),
            );
            deployment.setGuardSignature = Buffer.from(
              toBytes(signature as `0x${string}`),
            );
            deployment.validators = validators;
            deployment.status = UserDeploymentStatus.PendingDeployment;
            deployment.createdAt = now;
            deployment.updatedAt = now;
            return deployment;
          } else {
            const safe = await this.getSafe(
              deploymentConfig.operator,
              owner,
              deploymentConfig.saltNonce,
              currentChainId,
            );
            const address = await safe.getAddress();
            const deployment = new UserDeployment();
            deployment.id = Buffer.from(uuidParse(uuidV7()));
            deployment.userId = newUser.id;
            deployment.chainId = currentChainId;
            deployment.address = Buffer.from(toBytes(address as `0x${string}`));
            deployment.operator = Buffer.from(
              toBytes(deploymentConfig.operator as `0x${string}`),
            );
            deployment.guard = Buffer.from(
              toBytes(deploymentConfig.guard as `0x${string}`),
            );
            deployment.setGuardSignature = null;
            deployment.validators = null;
            deployment.status = UserDeploymentStatus.Uninitialized;
            deployment.createdAt = now;
            deployment.updatedAt = now;
            return deployment;
          }
        },
      ),
    );

    if (
      deployments.findIndex(
        (deployment) =>
          deployment.chainId === chainId &&
          deployment.status === UserDeploymentStatus.PendingDeployment,
      ) === -1
    ) {
      throw new NetworkNotSupportedException(network);
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.save(User, newUser);
      for (const deployment of deployments) {
        await queryRunner.manager.save(UserDeployment, deployment);
      }
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
    return getUserResponseDto(newUser, deployments, deploymentConfigs);
  }

  async verifySignature(
    owner: string,
    safe: Safe,
    safeTransaction: EthSafeTransaction,
    signature: string,
  ): Promise<boolean> {
    const safeEIP712Args: SafeEIP712Args = {
      safeAddress: await safe.getAddress(),
      safeVersion: safe.getContractVersion(),
      chainId: await safe.getChainId(),
      data: safeTransaction.data,
    };

    const typedData = generateTypedData(safeEIP712Args);
    const { chainId, verifyingContract } = typedData.domain;
    const chain = chainId ? Number(chainId) : undefined; // ensure empty string becomes undefined
    const domain = { verifyingContract: verifyingContract, chainId: chain };

    try {
      const isValid = await verifyTypedData({
        domain,
        types:
          typedData.primaryType === 'SafeMessage'
            ? {
                SafeMessage: (typedData as EIP712TypedDataMessage).types
                  .SafeMessage,
              }
            : { SafeTx: (typedData as EIP712TypedDataTx).types.SafeTx },
        primaryType: typedData.primaryType,
        message: typedData.message,
        address: owner,
        signature: signature as `0x${string}`,
      });

      return isValid;
    } catch (error) {
      this.logger.error(
        `Failed to verify signature to owner: ${owner} signature: ${signature} error: ${error}`,
      );
      return false;
    }
  }

  async getWrappedDeploymentConfig(
    network: NetworkDto,
    owner: string,
    sig: string,
  ) {
    const chainId = getChainId(network);
    const deploymentConfig =
      this.deploymentService.getDeploymentConfig(network);
    if (!deploymentConfig) {
      throw new NetworkNotSupportedException(network);
    }
    const validatorConfigs = VALIDATOR_CONFIGS[network];
    if (!validatorConfigs) {
      throw new NetworkNotSupportedException(network);
    }
    const safe = await this.getSafe(
      deploymentConfig.operator,
      owner,
      deploymentConfig.saltNonce,
      chainId,
    );
    const tx = await this.getSetGuardTransaction(
      network,
      deploymentConfig,
      validatorConfigs,
      safe,
    );
    tx.addSignature(new EthSafeSignature(owner, sig));
    const data = await safe.getEncodedTransaction(tx);
    return {
      predictedSafe: safe.getPredictedSafe(),
      wrappedTx: [
        {
          to: await safe.getAddress(),
          data,
          value: '0',
        },
      ],
    };
  }

  async getSetGuardTransaction(
    network: NetworkDto,
    deploymentConfig: DeploymentConfigResponseDto,
    validatorConfig: ValidatorConfig,
    safe: Safe,
  ): Promise<EthSafeTransaction> {
    const address = await safe.getAddress();
    const setGuardTx = {
      to: address,
      data: encodeFunctionData({
        abi: SAFE_ABI,
        functionName: 'setGuard',
        args: [deploymentConfig.guard],
      }),
      value: '0',
    };

    const validatorTxs = deploymentConfig.validators.flatMap((validator) => {
      switch (validator.type) {
        case ValidatorTypeDto.UniswapV3:
          const uniswapV3NonFungiblePositionManager =
            validatorConfig.uniswapV3NonFungiblePositionManager;
          if (!uniswapV3NonFungiblePositionManager) {
            throw new ValidatorNotSupportedException(
              network,
              ValidatorTypeDto.UniswapV3,
            );
          }
          return [
            {
              to: deploymentConfig.guard,
              data: encodeFunctionData({
                abi: OWLIA_GUARD_ABI,
                functionName: 'setValidator',
                args: [
                  uniswapV3NonFungiblePositionManager,
                  validator.validator,
                ],
              }),
              value: '0',
            },
            ...validator.pools.map((pool) => ({
              to: validator.validator,
              data: encodeFunctionData({
                abi: UNISWAP_V3_OWLIA_VALIDATOR_ABI,
                functionName: 'setPoolConfig',
                args: [
                  pool.token0,
                  pool.token1,
                  pool.fee,
                  pool.tickLower,
                  pool.tickUpper,
                ],
              }),
              value: '0',
            })),
          ];
        case ValidatorTypeDto.AerodromeCL:
          const aerodromeCLNonFungiblePositionManager =
            validatorConfig.aerodromeCLNonFungiblePositionManager;
          if (!aerodromeCLNonFungiblePositionManager) {
            throw new ValidatorNotSupportedException(
              network,
              ValidatorTypeDto.AerodromeCL,
            );
          }

          return [
            {
              to: deploymentConfig.guard,
              data: encodeFunctionData({
                abi: OWLIA_GUARD_ABI,
                functionName: 'setValidator',
                args: [
                  aerodromeCLNonFungiblePositionManager,
                  validator.validator,
                ],
              }),
              value: '0',
            },
            ...validator.pools.map((pool) => ({
              to: validator.validator,
              data: encodeFunctionData({
                abi: UNISWAP_V3_OWLIA_VALIDATOR_ABI,
                functionName: 'setPoolConfig',
                args: [
                  pool.token0,
                  pool.token1,
                  pool.tickSpacing,
                  pool.tickLower,
                  pool.tickUpper,
                ],
              }),
              value: '0',
            })),
          ];
        case ValidatorTypeDto.AaveV3:
          const aaveV3Pool = validatorConfig.aaveV3Pool;
          if (!aaveV3Pool) {
            throw new ValidatorNotSupportedException(
              network,
              ValidatorTypeDto.AaveV3,
            );
          }

          return [
            {
              to: deploymentConfig.guard,
              data: encodeFunctionData({
                abi: OWLIA_GUARD_ABI,
                functionName: 'setValidator',
                args: [aaveV3Pool, validator.validator],
              }),
              value: '0',
            },
            ...validator.assets.map((asset) => ({
              to: validator.validator,
              data: encodeFunctionData({
                abi: AAVE_V3_OWLIA_VALIDATOR_ABI,
                functionName: 'setAllowedAsset',
                args: [asset, true],
              }),
              value: '0',
            })),
          ];
        case ValidatorTypeDto.EulerV2:
          const eulerV2EVC = validatorConfig.eulerV2EVC;
          if (!eulerV2EVC) {
            throw new ValidatorNotSupportedException(
              network,
              ValidatorTypeDto.EulerV2,
            );
          }

          return [
            {
              to: deploymentConfig.guard,
              data: encodeFunctionData({
                abi: OWLIA_GUARD_ABI,
                functionName: 'setValidator',
                args: [eulerV2EVC, validator.validator],
              }),
              value: '0',
            },
            ...validator.vaults.map((vault) => ({
              to: validator.validator,
              data: encodeFunctionData({
                abi: EULER_V2_OWLIA_VALIDATOR_ABI,
                functionName: 'setAllowedVault',
                args: [vault, true],
              }),
              value: '0',
            })),
          ];
        case ValidatorTypeDto.VenusV4:
          const venusV4Comptroller = validatorConfig.venusV4Comptroller;
          if (!venusV4Comptroller) {
            throw new ValidatorNotSupportedException(
              network,
              ValidatorTypeDto.VenusV4,
            );
          }

          return [
            {
              to: deploymentConfig.guard,
              data: encodeFunctionData({
                abi: OWLIA_GUARD_ABI,
                functionName: 'setValidator',
                args: [venusV4Comptroller, validator.validator],
              }),
              value: '0',
            },
            ...validator.vaults.flatMap((vault) => [
              {
                to: deploymentConfig.guard,
                data: encodeFunctionData({
                  abi: OWLIA_GUARD_ABI,
                  functionName: 'setValidator',
                  args: [vault, validator.validator],
                }),
                value: '0',
              },
              {
                to: validator.validator,
                data: encodeFunctionData({
                  abi: VENUS_V4_OWLIA_VALIDATOR_ABI,
                  functionName: 'setAllowedVault',
                  args: [vault, true],
                }),
                value: '0',
              },
            ]),
          ];
        case ValidatorTypeDto.KyberSwap:
          const kyberSwapRouter = validatorConfig.kyberSwapRouter;
          if (!kyberSwapRouter) {
            throw new ValidatorNotSupportedException(
              network,
              ValidatorTypeDto.KyberSwap,
            );
          }

          return [
            {
              to: deploymentConfig.guard,
              data: encodeFunctionData({
                abi: OWLIA_GUARD_ABI,
                functionName: 'setValidator',
                args: [kyberSwapRouter, validator.validator],
              }),
              value: '0',
            },
            ...validator.tokens.flatMap((token) => [
              {
                to: deploymentConfig.guard,
                data: encodeFunctionData({
                  abi: OWLIA_GUARD_ABI,
                  functionName: 'setValidator',
                  args: [kyberSwapRouter, validator.validator],
                }),
                value: '0',
              },
              {
                to: validator.validator,
                data: encodeFunctionData({
                  abi: KYBER_SWAP_OWLIA_VALIDATOR_ABI,
                  functionName: 'setAllowedToken',
                  args: [token, true],
                }),
                value: '0',
              },
            ]),
          ];
      }
    });

    const transaction = await safe.createTransaction({
      transactions: [setGuardTx, ...validatorTxs],
    });
    return transaction;
  }

  async getDeploymentByAddress(
    address: string,
    network: NetworkDto,
  ): Promise<UserDeployment | null> {
    const chainId = getChainId(network);
    const addressBuffer = Buffer.from(toBytes(address as `0x${string}`));
    const deployment = await this.userDeploymentRepository.findOne({
      where: {
        address: addressBuffer,
        chainId: chainId,
      },
    });
    return deployment;
  }
}
