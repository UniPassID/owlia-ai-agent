import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import Safe, {
  EthSafeSignature,
  EthSafeTransaction,
  generateTypedData,
  PredictedSafeProps,
} from '@safe-global/protocol-kit';
import { DataSource, In, MoreThan, Repository } from 'typeorm';
import { parse as uuidParse, v7 as uuidV7 } from 'uuid';
import {
  encodeFunctionData,
  fromBytes,
  getAddress,
  toBytes,
  verifyTypedData,
  zeroAddress,
} from 'viem';

import {
  InvalidSignatureException,
  NetworkNotSupportedException,
  UserAlreadyRegisteredException,
  DeploymentNotFoundException,
  UserNotFoundException,
  UserDeploymentDeploying,
} from '../../common/exceptions/base.exception';
import blockchainsConfig from '../../config/blockchains.config';
import { DeploymentService } from '../deployment/deployment.service';
import {
  DeploymentConfigResponseDto,
  ValidatorProtocolDto,
  ValidatorResponseDto,
} from '../deployment/dto/deployment.response.dto';
import { AAVE_V3_OWLIA_VALIDATOR_ABI } from '../../abis/aave-v3-owlia-validator.abi';
import { EULER_V2_OWLIA_VALIDATOR_ABI } from '../../abis/euler-v2-owlia-validator.abi';
import { OWLIA_GUARD_ABI } from '../../abis/owlia-guard.abi';
import { SAFE_ABI } from '../../abis/safe.abi';
import { TokenInfo } from './constants';
import {
  getChainId,
  getNetworkDto,
  NetworkDto,
} from '../../common/dto/network.dto';
import { DeploymentDto, toValidatorResponseDto } from './dto/register-user.dto';
import {
  getUninitializedUserDeploymentResponseDto,
  getUninitializedUserResponseDto,
  getUserResponseDto,
  UserResponseDto,
} from './dto/user.response.dto';
import { User } from './entities/user.entity';
import {
  isUserDeploymentDeployed,
  updateUserDeploymentStatus,
  UserDeployment,
  UserDeploymentStatus,
} from './entities/user-deployment.entity';
import {
  EIP712TypedDataMessage,
  EIP712TypedDataTx,
  MetaTransactionData,
  SafeEIP712Args,
} from '@safe-global/types-kit';
import { UserChainManager } from './utils/user-chain-manager';
import {
  PortfolioResponseDto,
  UserPortfoliosResponseDto,
} from './dto/user-portfolio.response.dto';
import { Cron } from '@nestjs/schedule';
import { UserPortfolio } from './entities/user-portfolio.entity';
import { UserPortfoliosRequestDto } from './dto/user-portfolio.dto';
import { EulerV2Service } from '../dexes/euler-v2/euler-v2.service';
import { AaveV3Service } from '../dexes/aave-v3/aave-v3.service';
import { TrackerService } from '../tracker/tracker.service';
import { OKX_SWAP_OWLIA_VALIDATOR_ABI } from '../../abis/okx-swap-owlia-validator.abi';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  private readonly rpcUrls: Record<NetworkDto, string[]>;
  private readonly userChainManager: Record<NetworkDto, UserChainManager>;

  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(UserDeployment)
    private userDeploymentRepository: Repository<UserDeployment>,
    @InjectRepository(UserPortfolio)
    private userPortfolioRepository: Repository<UserPortfolio>,
    private deploymentService: DeploymentService,
    private aaveV3Service: AaveV3Service,
    private eulerV2Service: EulerV2Service,
    private trackerService: TrackerService,
    @Inject(blockchainsConfig.KEY)
    blockchains: ConfigType<typeof blockchainsConfig>,
    private dataSource: DataSource,
  ) {
    const base_rpc_urls = blockchains.base.rpcUrls;
    this.rpcUrls = {
      [NetworkDto.Base]: base_rpc_urls,
    };
    this.userChainManager = {
      [NetworkDto.Base]: new UserChainManager(
        NetworkDto.Base,
        base_rpc_urls,
        this.trackerService,
        this.aaveV3Service,
        this.eulerV2Service,
      ),
    };
  }

  @Cron('0 */10 * * * *', { timeZone: 'UTC' })
  async storeUserPortfolios() {
    const snapTime = new Date(Math.floor(Date.now() / 1000 / 600) * 600 * 1000);
    const deployments = await this.userDeploymentRepository.find({
      where: {
        id: MoreThan(Buffer.from(new Array(16).fill(0))),
      },
    });

    deployments.forEach(async (deployment) => {
      const portfolio = await this.userChainManager[
        getNetworkDto(deployment.chainId)
      ].getUserPortfolio(
        getAddress(fromBytes(deployment.address, 'hex')),
        deployment.status === UserDeploymentStatus.Deployed,
      );
      const now = new Date();
      const userPortfolio = new UserPortfolio();
      userPortfolio.id = Buffer.from(uuidParse(uuidV7()));
      userPortfolio.deploymentId = deployment.id;
      userPortfolio.data = portfolio;
      userPortfolio.snapTime = snapTime;
      userPortfolio.createdAt = now;
      userPortfolio.updatedAt = now;
      await this.userPortfolioRepository.save(userPortfolio);
    });
  }

  getAllAllowedTokens(network: NetworkDto): TokenInfo[] {
    return this.userChainManager[network].allowedTokens;
  }

  async getUserPortfolio(
    network: NetworkDto,
    address: string,
  ): Promise<PortfolioResponseDto> {
    const addressBuffer = Buffer.from(toBytes(address as `0x${string}`));
    const deployment = await this.userDeploymentRepository.findOne({
      where: {
        chainId: getChainId(network),
        address: addressBuffer,
      },
    });
    if (!deployment) {
      throw new DeploymentNotFoundException(network, address);
    }
    return this.userChainManager[network].getUserPortfolio(
      address,
      deployment.status === UserDeploymentStatus.Deployed,
    );
  }

  async getUserPortfolios({
    network,
    address,
    inMultiTimestampMs,
    limit,
  }: UserPortfoliosRequestDto): Promise<UserPortfoliosResponseDto> {
    const addressBuffer = Buffer.from(toBytes(address as `0x${string}`));
    const deployment = await this.userDeploymentRepository.findOne({
      where: {
        chainId: getChainId(network),
        address: addressBuffer,
      },
    });
    if (!deployment) {
      throw new DeploymentNotFoundException(network, address);
    }

    const snapTimes =
      inMultiTimestampMs.length > 0
        ? inMultiTimestampMs.map((timestamp) => new Date(parseInt(timestamp)))
        : undefined;

    const portfolios = await this.userPortfolioRepository.find({
      where: {
        deploymentId: deployment.id,
        snapTime: snapTimes ? In(snapTimes) : undefined,
      },
      take: limit,
    });
    return {
      portfolios: portfolios.map((portfolio) => portfolio.data),
    };
  }

  async getUserInfo(owner: string): Promise<UserResponseDto> {
    const ownerBuffer = Buffer.from(toBytes(owner as `0x${string}`));
    const user = await this.userRepository.findOne({
      where: {
        owner: ownerBuffer,
      },
    });
    const deploymentConfigs =
      this.deploymentService.getDeploymentConfigsRecord();

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
            const safe = await this.getUndeployedSafe(
              owner,
              deploymentConfig,
              networkDto,
            );
            return getUninitializedUserDeploymentResponseDto(safe, chainId);
          },
        ),
      );

      return getUninitializedUserResponseDto(owner, deployments);
    }
  }

  async getUndeployedSafe(
    owner: string,
    deploymentConfig: DeploymentConfigResponseDto,
    network: NetworkDto,
  ): Promise<Safe> {
    const predictedSafe: PredictedSafeProps = {
      safeAccountConfig: {
        owners: [deploymentConfig.operator, owner],
        threshold: 1,
      },
      safeDeploymentConfig: {
        deploymentType: 'canonical',
        saltNonce: deploymentConfig.saltNonce,
        safeVersion: '1.4.1',
      },
    };
    const rpcUrl = this.rpcUrls[network][0];
    if (!rpcUrl) {
      throw new NetworkNotSupportedException(network);
    }
    const protocolKit = await Safe.init({
      predictedSafe,
      provider: rpcUrl,
    });
    return protocolKit;
  }

  async getDeployedSafe(address: string, network: NetworkDto): Promise<Safe> {
    const safe = await Safe.init({
      safeAddress: address as `0x${string}`,
      provider: this.rpcUrls[network][0],
    });
    return safe;
  }

  async registerUser(
    owner: string,
    registerDeployments: DeploymentDto[],
  ): Promise<UserResponseDto> {
    const ownerBuffer = Buffer.from(toBytes(owner as `0x${string}`));
    const user = await this.userRepository.findOne({
      where: {
        owner: ownerBuffer,
      },
    });

    if (user) {
      throw new UserAlreadyRegisteredException(owner);
    }

    const now = new Date();
    const newUser = new User();
    newUser.id = Buffer.from(uuidParse(uuidV7()));
    newUser.owner = ownerBuffer;
    newUser.createdAt = now;
    newUser.updatedAt = now;

    const deploymentConfigs =
      this.deploymentService.getDeploymentConfigsRecord();

    const deployments = await Promise.all(
      registerDeployments.map(async (deployment) => {
        const deploymentConfig = deploymentConfigs[deployment.network];
        if (!deploymentConfig) {
          throw new NetworkNotSupportedException(deployment.network);
        }

        return await this.getNewDeploymentEntity(
          newUser,
          deploymentConfig,
          deployment,
        );
      }),
    );

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

  async updateDeployment(
    owner: string,
    deployments: DeploymentDto[],
  ): Promise<UserResponseDto> {
    const user = await this.userRepository.findOne({
      where: {
        owner: Buffer.from(toBytes(owner as `0x${string}`)),
      },
    });
    if (!user) {
      throw new UserNotFoundException(owner);
    }
    const deploymentEntities = await this.userDeploymentRepository.find({
      where: {
        userId: user.id,
      },
    });

    const deploymentConfigs =
      this.deploymentService.getDeploymentConfigsRecord();

    const updatedDeployments = await Promise.all(
      deployments.map(async (deployment) => {
        const deploymentEntity = deploymentEntities.find(
          (deploymentEntity) =>
            deploymentEntity.chainId === getChainId(deployment.network),
        );

        const deploymentConfig = deploymentConfigs[deployment.network];
        if (!deploymentConfig) {
          throw new NetworkNotSupportedException(deployment.network);
        }

        if (deploymentEntity) {
          return await this.getUpdatingDeploymentEntity(
            user,
            deploymentConfig,
            deploymentEntity,
            deployment,
          );
        } else {
          return await this.getNewDeploymentEntity(
            user,
            deploymentConfig,
            deployment,
          );
        }
      }),
    );
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      for (const deployment of updatedDeployments) {
        await queryRunner.manager.save(UserDeployment, deployment);
      }
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    const newDeploymentEntities = deploymentEntities.map((deploymentEntity) => {
      const updatedDeployment = updatedDeployments.find((updatedDeployment) => {
        return updatedDeployment.id == deploymentEntity.id;
      });
      if (updatedDeployment) {
        return updatedDeployment;
      } else {
        return deploymentEntity;
      }
    });
    return getUserResponseDto(user, newDeploymentEntities, deploymentConfigs);
  }

  async getNewDeploymentEntity(
    user: User,
    deploymentConfig: DeploymentConfigResponseDto,
    deployment: DeploymentDto,
  ): Promise<UserDeployment> {
    const owner = fromBytes(user.owner, 'hex');
    const safe = await this.getUndeployedSafe(
      owner,
      deploymentConfig,
      deployment.network,
    );

    const validators = toValidatorResponseDto(
      deployment.network,
      deployment.validators,
      deploymentConfig.validators,
    );

    const address = await safe.getAddress();
    const transactions: MetaTransactionData[] = [];
    const setGuardTx = await this.getSetGuardTransaction(
      deploymentConfig,
      safe,
    );
    if (setGuardTx) {
      transactions.push(setGuardTx);
    }

    const validatorTxs = this.getValidatorTransactions(
      deploymentConfig,
      [],
      validators,
    );
    transactions.push(...validatorTxs);

    const transaction = await safe.createTransaction({
      transactions,
    });

    const isValid = await this.verifySignature(
      fromBytes(user.owner, 'hex'),
      safe,
      transaction,
      deployment.signature,
    );
    if (!isValid) {
      throw new InvalidSignatureException();
    }

    const now = new Date();
    const deploymentEntity = new UserDeployment();
    deploymentEntity.id = Buffer.from(uuidParse(uuidV7()));
    deploymentEntity.userId = user.id;
    deploymentEntity.chainId = getChainId(deploymentConfig.network);
    deploymentEntity.address = Buffer.from(toBytes(address as `0x${string}`));
    deploymentEntity.operator = Buffer.from(
      toBytes(deploymentConfig.operator as `0x${string}`),
    );
    deploymentEntity.guard = Buffer.from(
      toBytes(deploymentConfig.guard as `0x${string}`),
    );
    deploymentEntity.signature = Buffer.from(
      toBytes(deployment.signature as `0x${string}`),
    );
    deploymentEntity.validators = JSON.parse(
      JSON.stringify(deployment.validators),
    );
    deploymentEntity.status = UserDeploymentStatus.PendingDeployment;
    deploymentEntity.createdAt = now;
    deploymentEntity.updatedAt = now;
    return deploymentEntity;
  }

  async getUpdatingDeploymentEntity(
    user: User,
    deploymentConfig: DeploymentConfigResponseDto,
    deploymentEntity: UserDeployment,
    deployment: DeploymentDto,
  ): Promise<UserDeployment> {
    const owner = fromBytes(user.owner, 'hex');
    const safe = await this.getUndeployedSafe(
      owner,
      deploymentConfig,
      deployment.network,
    );

    const isDeploymentDeployed = isUserDeploymentDeployed(
      deploymentEntity.status,
    );

    let oldValidators: ValidatorResponseDto[] = [];

    if (isDeploymentDeployed) {
      oldValidators = toValidatorResponseDto(
        deployment.network,
        deploymentEntity.validators,
        deploymentConfig.validators,
      );
    }

    const validators = toValidatorResponseDto(
      deployment.network,
      deployment.validators,
      deploymentConfig.validators,
    );

    const transactions: MetaTransactionData[] = [];
    const setGuardTx = await this.getSetGuardTransaction(
      deploymentConfig,
      safe,
    );
    if (setGuardTx) {
      transactions.push(setGuardTx);
    } else if (!isDeploymentDeployed) {
      throw new UserDeploymentDeploying();
    }

    const validatorTxs = this.getValidatorTransactions(
      deploymentConfig,
      oldValidators,
      validators,
    );
    transactions.push(...validatorTxs);

    const transaction = await safe.createTransaction({
      transactions,
    });

    const isValid = await this.verifySignature(
      fromBytes(user.owner, 'hex'),
      safe,
      transaction,
      deployment.signature,
    );
    if (!isValid) {
      throw new InvalidSignatureException();
    }

    const now = new Date();

    if (isDeploymentDeployed) {
      deploymentEntity.oldValidators = deploymentEntity.validators;
    }
    deploymentEntity.validators = JSON.parse(
      JSON.stringify(deployment.validators),
    );
    deploymentEntity.signature = Buffer.from(
      toBytes(deployment.signature as `0x${string}`),
    );
    deploymentEntity.status = updateUserDeploymentStatus(
      deploymentEntity.status,
    );
    deploymentEntity.updatedAt = now;
    return deploymentEntity;
  }

  async verifySignature(
    owner: string,
    safe: Safe,
    safeTransaction: EthSafeTransaction,
    signature: string,
  ): Promise<boolean> {
    try {
      const typedData = await this.getTypedData(owner, safe, safeTransaction);
      const isValid = await verifyTypedData({
        ...typedData,
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

  async getTypedData(
    signer: string,
    safe: Safe,
    safeTransaction: EthSafeTransaction,
  ) {
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

    return {
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
      address: signer,
    };
  }

  async getSetGuardTransaction(
    deploymentConfig: DeploymentConfigResponseDto,
    safe: Safe,
  ): Promise<MetaTransactionData | undefined> {
    if (await safe.isSafeDeployed()) {
      return undefined;
    } else {
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
      return setGuardTx;
    }
  }

  getValidatorTransactions(
    deploymentConfig: DeploymentConfigResponseDto,
    oldValidators: ValidatorResponseDto[],
    validators: ValidatorResponseDto[],
  ): MetaTransactionData[] {
    const clearValidatorTxs = oldValidators.flatMap((validator) => {
      switch (validator.protocol) {
        case ValidatorProtocolDto.AaveV3: {
          const setValidatorTxs = validator.targets.map((target) => ({
            to: deploymentConfig.guard,
            data: encodeFunctionData({
              abi: OWLIA_GUARD_ABI,
              functionName: 'setValidator',
              args: [target, zeroAddress],
            }),
            value: '0',
          }));
          const setAllowedAssetTxs = validator.markets.map((market) => ({
            to: validator.validator,
            data: encodeFunctionData({
              abi: AAVE_V3_OWLIA_VALIDATOR_ABI,
              functionName: 'setAllowedAsset',
              args: [market.contract, false],
            }),
            value: '0',
          }));

          return [...setValidatorTxs, ...setAllowedAssetTxs];
        }

        case ValidatorProtocolDto.EulerV2: {
          const setValidatorTxs = validator.targets.map((target) => ({
            to: deploymentConfig.guard,
            data: encodeFunctionData({
              abi: OWLIA_GUARD_ABI,
              functionName: 'setValidator',
              args: [target, zeroAddress],
            }),
            value: '0',
          }));
          const setAllowedVaultTxs = validator.markets.map((market) => ({
            to: validator.validator,
            data: encodeFunctionData({
              abi: EULER_V2_OWLIA_VALIDATOR_ABI,
              functionName: 'setAllowedVault',
              args: [market.contract, false],
            }),
            value: '0',
          }));
          return [...setValidatorTxs, ...setAllowedVaultTxs];
        }
        case ValidatorProtocolDto.OkxSwap: {
          const setValidatorTxs = validator.targets.map((target) => ({
            to: deploymentConfig.guard,
            data: encodeFunctionData({
              abi: OWLIA_GUARD_ABI,
              functionName: 'setValidator',
              args: [target, zeroAddress],
            }),
            value: '0',
          }));
          const setAllowedTokenTxs = validator.assets.flatMap((asset) => ({
            to: validator.validator,
            data: encodeFunctionData({
              abi: OKX_SWAP_OWLIA_VALIDATOR_ABI,
              functionName: 'setAllowedToken',
              args: [asset.contract, false],
            }),
            value: '0',
          }));
          return [...setValidatorTxs, ...setAllowedTokenTxs];
        }
      }
    });

    const setValidatorTxs = validators.flatMap((validator) => {
      switch (validator.protocol) {
        case ValidatorProtocolDto.AaveV3: {
          const setValidatorTxs = validator.targets.map((target) => ({
            to: deploymentConfig.guard,
            data: encodeFunctionData({
              abi: OWLIA_GUARD_ABI,
              functionName: 'setValidator',
              args: [target, validator.validator],
            }),
            value: '0',
          }));
          const setAllowedAssetTxs = validator.markets.map((market) => ({
            to: validator.validator,
            data: encodeFunctionData({
              abi: AAVE_V3_OWLIA_VALIDATOR_ABI,
              functionName: 'setAllowedAsset',
              args: [market.contract, true],
            }),
            value: '0',
          }));

          return [...setValidatorTxs, ...setAllowedAssetTxs];
        }

        case ValidatorProtocolDto.EulerV2: {
          const setValidatorTxs = validator.targets.map((target) => ({
            to: deploymentConfig.guard,
            data: encodeFunctionData({
              abi: OWLIA_GUARD_ABI,
              functionName: 'setValidator',
              args: [target, validator.validator],
            }),
            value: '0',
          }));
          const setAllowedVaultTxs = validator.markets.map((market) => ({
            to: validator.validator,
            data: encodeFunctionData({
              abi: EULER_V2_OWLIA_VALIDATOR_ABI,
              functionName: 'setAllowedVault',
              args: [market.contract, true],
            }),
            value: '0',
          }));
          return [...setValidatorTxs, ...setAllowedVaultTxs];
        }
        case ValidatorProtocolDto.OkxSwap: {
          const setValidatorTxs = validator.targets.map((target) => ({
            to: deploymentConfig.guard,
            data: encodeFunctionData({
              abi: OWLIA_GUARD_ABI,
              functionName: 'setValidator',
              args: [target, validator.validator],
            }),
            value: '0',
          }));
          const setAllowedTokenTxs = validator.assets.flatMap((asset) => ({
            to: validator.validator,
            data: encodeFunctionData({
              abi: OKX_SWAP_OWLIA_VALIDATOR_ABI,
              functionName: 'setAllowedToken',
              args: [asset.contract, true],
            }),
            value: '0',
          }));
          return [...setValidatorTxs, ...setAllowedTokenTxs];
        }
      }
    });

    return [...clearValidatorTxs, ...setValidatorTxs];
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

  async getDeploymentSignedTransaction(
    network: NetworkDto,
    address: string,
  ): Promise<{
    safe: Safe;
    wrappedTransaction?: MetaTransactionData;
    operator: string;
  }> {
    const deployment = await this.getDeploymentByAddress(address, network);
    if (!deployment) {
      throw new DeploymentNotFoundException(network, address);
    }

    if (deployment.status === UserDeploymentStatus.Uninitialized) {
      throw new Error('Deployment is not deployed');
    }

    if (deployment.status === UserDeploymentStatus.Deployed) {
      return {
        safe: await this.getDeployedSafe(address, network),
        operator: getAddress(fromBytes(deployment.operator, 'hex')),
      };
    }

    if (deployment.validators === null) {
      throw new Error('Deployment validators are not set');
    }

    if (deployment.signature === null) {
      throw new Error('Deployment set guard signature is not set');
    }

    const user = await this.userRepository.findOne({
      where: {
        id: deployment.userId,
      },
    });
    if (!user) {
      throw new DeploymentNotFoundException(network, address);
    }
    const deploymentConfig =
      this.deploymentService.getDeploymentConfig(network);

    const safe = await this.getUndeployedSafe(
      getAddress(fromBytes(user.owner, 'hex')),
      deploymentConfig,
      network,
    );
    const oldValidators = toValidatorResponseDto(
      network,
      deployment.oldValidators || [],
      deploymentConfig.validators,
    );
    const validators = toValidatorResponseDto(
      network,
      deployment.validators,
      deploymentConfig.validators,
    );

    const transactions: MetaTransactionData[] = [];
    const setGuardTx = await this.getSetGuardTransaction(
      deploymentConfig,
      safe,
    );

    if (setGuardTx) {
      transactions.push(setGuardTx);
    }

    const validatorTxs = await this.getValidatorTransactions(
      deploymentConfig,
      oldValidators,
      validators,
    );
    transactions.push(...validatorTxs);

    const transaction = await safe.createTransaction({
      transactions,
    });

    transaction.addSignature(
      new EthSafeSignature(
        getAddress(fromBytes(user.owner, 'hex')),
        fromBytes(deployment.signature, 'hex'),
      ),
    );
    const wrappedTransaction =
      await safe.wrapSafeTransactionIntoDeploymentBatch(transaction);
    return {
      safe,
      wrappedTransaction,
      operator: getAddress(fromBytes(deployment.operator, 'hex')),
    };
  }
}
