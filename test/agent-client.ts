import * as request from 'supertest';
import { App } from 'supertest/types';

import { ResponseCodeDto, ResponseDto } from '../src/common/dto/response.dto';
import {
  DeploymentConfigResponseDto,
  ValidatorTypeDto,
} from '../src/deployment/dto/deployment.response.dto';
import { NetworkDto } from '../src/common/dto/network.dto';
import { UserResponseDto } from '../src/user/dto/user.response.dto';
import { ValidatorDto } from '../src/user/dto/register-user.dto';
import { VALIDATOR_CONFIGS, ValidatorConfig } from '../src/user/constants';
import { encodeFunctionData } from 'viem';
import { OWLIA_GUARD_ABI } from '../src/user/abis/owlia-guard.abi';
import { UNISWAP_V3_OWLIA_VALIDATOR_ABI } from '../src/user/abis/uniswap-v3-owlia-validator.abi';
import { AAVE_V3_OWLIA_VALIDATOR_ABI } from '../src/user/abis/aave-v3-owlia-validator.abi';
import { EULER_V2_OWLIA_VALIDATOR_ABI } from '../src/user/abis/euler-v2-owlia-validator.abi';
import { VENUS_V4_OWLIA_VALIDATOR_ABI } from '../src/user/abis/venus-v4-owlia-validator.abi';
import { KYBER_SWAP_OWLIA_VALIDATOR_ABI } from '../src/user/abis/kyber-swap-owlia-validator.abi';
import { MetaTransactionData } from '@safe-global/types-kit';
import Safe from '@safe-global/protocol-kit';
import { SAFE_ABI } from '../src/user/abis/safe.abi';
import { PortfolioResponseDto } from '../src/user/dto/portfolio.response.dto';

export class AgentClient {
  #validatorConfigs: Record<NetworkDto, ValidatorConfig> = VALIDATOR_CONFIGS;

  constructor(private readonly app: App) {}

  async deploymentConfig(
    network: NetworkDto,
  ): Promise<DeploymentConfigResponseDto> {
    const response = await request(this.app).get(
      `/api/v1/deployment/config?network=${network}`,
    );
    const data = response.body as ResponseDto<DeploymentConfigResponseDto>;
    if (data.code !== ResponseCodeDto.Success) {
      throw new Error(`Failed to get deployment config: ${data.message}`);
    }
    return data.data;
  }

  async registerUser(
    network: NetworkDto,
    owner: string,
    validators: ValidatorDto[],
    signature: string,
  ): Promise<UserResponseDto> {
    const response = await request(this.app)
      .post(`/api/v1/user/register`)
      .send({
        network,
        owner,
        validators,
        signature,
      });
    const data = response.body as ResponseDto<UserResponseDto>;
    if (data.code !== ResponseCodeDto.Success) {
      throw new Error(`Failed to register user: ${data.message}`);
    }
    return data.data;
  }

  async registerUserWithOwner(
    network: NetworkDto,
    deploymentConfig: DeploymentConfigResponseDto,
    owner: string,
    ownerPrivateKey: string,
    rpcUrl: string,
  ): Promise<UserResponseDto> {
    const safe = await this.getSafe(
      deploymentConfig,
      owner,
      ownerPrivateKey,
      rpcUrl,
    );

    const setGuardTx = await this.setGuardTx(safe, deploymentConfig);

    const validatorTxs = this.getValidatorTxs(network, deploymentConfig);

    const transaction = await safe.createTransaction({
      transactions: [setGuardTx, ...validatorTxs],
    });
    const signedTransaction = await safe.signTransaction(transaction);
    const sig = signedTransaction.encodedSignatures();
    return this.registerUser(network, owner, deploymentConfig.validators, sig);
  }

  async getUserPortfolio(
    network: NetworkDto,
    address: string,
  ): Promise<PortfolioResponseDto> {
    const response = await request(this.app).get(
      `/api/v1/user/portfolio?network=${network}&address=${address}`,
    );
    const data = response.body as ResponseDto<PortfolioResponseDto>;
    if (data.code !== ResponseCodeDto.Success) {
      throw new Error(`Failed to get user portfolio: ${data.message}`);
    }
    return data.data;
  }

  async setGuardTx(
    safe: Safe,
    deploymentConfig: DeploymentConfigResponseDto,
  ): Promise<MetaTransactionData> {
    const address = await safe.getAddress();
    return {
      to: address,
      data: encodeFunctionData({
        abi: SAFE_ABI,
        functionName: 'setGuard',
        args: [deploymentConfig.guard],
      }),
      value: '0',
    };
  }

  getValidatorTxs(
    network: NetworkDto,
    deploymentConfig: DeploymentConfigResponseDto,
  ): MetaTransactionData[] {
    const validatorConfig = this.#validatorConfigs[network];
    if (!validatorConfig) {
      throw new Error(`Validator config not found for network: ${network}`);
    }
    const validatorTxs = deploymentConfig.validators.flatMap((validator) => {
      switch (validator.type) {
        case ValidatorTypeDto.UniswapV3:
          const uniswapV3NonFungiblePositionManager =
            validatorConfig.uniswapV3NonFungiblePositionManager;
          if (!uniswapV3NonFungiblePositionManager) {
            throw new Error('UniswapV3NonFungiblePositionManager not found');
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
            throw new Error('AerodromeCLNonFungiblePositionManager not found');
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
            throw new Error('AaveV3Pool not found');
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
            throw new Error('EulerV2EVC not found');
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
            throw new Error('VenusV4Comptroller not found');
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
            throw new Error('KyberSwapRouter not found');
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
    return validatorTxs;
  }

  async getSafe(
    deploymentConfig: DeploymentConfigResponseDto,
    owner: string,
    ownerPrivateKey: string,
    rpcUrl: string,
  ): Promise<Safe> {
    const safe = await Safe.init({
      predictedSafe: {
        safeAccountConfig: {
          owners: [deploymentConfig.operator, owner],
          threshold: 1,
        },
        safeDeploymentConfig: {
          deploymentType: 'canonical',
          saltNonce: deploymentConfig.saltNonce,
          safeVersion: '1.4.1',
        },
      },
      signer: ownerPrivateKey,
      provider: rpcUrl,
    });
    return safe;
  }

  async getUserInfo(owner: string): Promise<UserResponseDto> {
    const response = await request(this.app).get(`/api/v1/user?owner=${owner}`);
    const data = response.body as ResponseDto<UserResponseDto>;
    if (data.code !== ResponseCodeDto.Success) {
      throw new Error(`Failed to get user info: ${data.message}`);
    }
    return data.data;
  }
}
