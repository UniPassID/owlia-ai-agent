import * as request from 'supertest';
import { App } from 'supertest/types';

import {
  ResponseCodeDto,
  ResponseDto,
} from '../../src/common/dto/response.dto';
import {
  DeploymentConfigResponseDto,
  DeploymentConfigsResponseDto,
  ValidatorProtocolDto,
} from '../../src/modules/deployment/dto/deployment.response.dto';
import { UserResponseDto } from '../../src/modules/user/dto/user.response.dto';
import { DeploymentDto } from '../../src/modules/user/dto/register-user.dto';
import { encodeFunctionData, zeroAddress } from 'viem';
import { OWLIA_GUARD_ABI } from '../../src/abis/owlia-guard.abi';
import { AAVE_V3_OWLIA_VALIDATOR_ABI } from '../../src/abis/aave-v3-owlia-validator.abi';
import { EULER_V2_OWLIA_VALIDATOR_ABI } from '../../src/abis/euler-v2-owlia-validator.abi';
import { OKX_SWAP_OWLIA_VALIDATOR_ABI } from '../../src/abis/okx-swap-owlia-validator.abi';
import { MetaTransactionData } from '@safe-global/types-kit';
import Safe from '@safe-global/protocol-kit';
import { SAFE_ABI } from '../../src/abis/safe.abi';
import {
  PortfolioResponseDto,
  UserPortfoliosResponseDto,
} from '../../src/modules/user/dto/user-portfolio.response.dto';
import { NetworkDto } from '../../src/common/dto/network.dto';
import { UpdateDeploymentDto } from '../../src/modules/user/dto/update-deployment.dto';

export class AgentClient {
  constructor(private readonly app: App) {}

  async deploymentConfigs(): Promise<DeploymentConfigsResponseDto> {
    const response = await request(this.app).get(
      `/api/v1/deployment/config/list`,
    );
    const data = response.body as ResponseDto<DeploymentConfigsResponseDto>;
    if (data.code !== ResponseCodeDto.Success) {
      throw new Error(`Failed to get deployment config: ${data.message}`);
    }
    return data.data;
  }

  async registerUser(
    owner: string,
    deployments: DeploymentDto[],
  ): Promise<UserResponseDto> {
    const response = await request(this.app)
      .post(`/api/v1/user/register`)
      .send({
        owner,
        deployments,
      });
    const data = response.body satisfies ResponseDto<UserResponseDto>;
    if (data.code !== ResponseCodeDto.Success) {
      throw new Error(`Failed to register user: ${data.message}`);
    }
    return data.data;
  }

  async registerUserWithOwner(
    owner: string,
    ownerPrivateKey: string,
    deploymentConfigs: DeploymentConfigResponseDto[],
    rpcUrl: string,
  ): Promise<UserResponseDto> {
    const deployments = await Promise.all(
      deploymentConfigs.map(async (deploymentConfig) => {
        const safe = await this.getSafe(
          deploymentConfig,
          owner,
          ownerPrivateKey,
          rpcUrl,
        );

        const setGuardTx = await this.setGuardTx(safe, deploymentConfig);

        const validatorTxs = this.getValidatorTxs(deploymentConfig);

        const transaction = await safe.createTransaction({
          transactions: [setGuardTx, ...validatorTxs],
        });
        const signedTransaction = await safe.signTransaction(transaction);
        const sig = signedTransaction.encodedSignatures();
        return {
          network: deploymentConfig.network,
          validators: deploymentConfig.validators,
          signature: sig,
        };
      }),
    );

    return this.registerUser(owner, deployments);
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

  async updateUserDeploymentWithOwner(
    owner: string,
    ownerPrivateKey: string,
    oldDeploymentConfigs: DeploymentConfigResponseDto[],
    newDeploymentConfigs: DeploymentConfigResponseDto[],
    rpcUrl: string,
  ): Promise<UserResponseDto> {
    const deployments = await Promise.all(
      newDeploymentConfigs.map(async (deploymentConfig) => {
        const safe = await this.getSafe(
          deploymentConfig,
          owner,
          ownerPrivateKey,
          rpcUrl,
        );

        const transactions: MetaTransactionData[] = [];

        if (!(await safe.isSafeDeployed())) {
          const setGuardTx = await this.setGuardTx(safe, deploymentConfig);
          transactions.push(setGuardTx);
        }

        const validatorTxs = this.getValidatorTxs(
          deploymentConfig,
          oldDeploymentConfigs.find(
            (oldDeploymentConfig) =>
              oldDeploymentConfig.network === deploymentConfig.network,
          ),
        );
        transactions.push(...validatorTxs);

        const transaction = await safe.createTransaction({
          transactions,
        });
        const signedTransaction = await safe.signTransaction(transaction);
        const sig = signedTransaction.encodedSignatures();
        return {
          network: deploymentConfig.network,
          validators: deploymentConfig.validators,
          signature: sig,
        };
      }),
    );

    return await this.updateUserDeployment(owner, deployments);
  }

  async updateUserDeployment(
    owner: string,
    deployments: DeploymentDto[],
  ): Promise<UserResponseDto> {
    const req = {
      owner,
      deployments,
    } satisfies UpdateDeploymentDto;

    const response = await request(this.app)
      .post(`/api/v1/user/deployment/update`)
      .send(req);
    const data = response.body as ResponseDto<UserResponseDto>;
    if (data.code !== ResponseCodeDto.Success) {
      throw new Error(`Failed to update user deployment: ${data.message}`);
    }
    return data.data;
  }

  async getUserPortfolios(
    network: NetworkDto,
    address: string,
    inMultiTimestampMs: string[],
    limit: number,
  ): Promise<UserPortfoliosResponseDto> {
    const response = await request(this.app)
      .post(`/api/v1/user/portfolios`)
      .send({
        network,
        address,
        inMultiTimestampMs,
        limit,
      });
    const data = response.body as ResponseDto<UserPortfoliosResponseDto>;
    if (data.code !== ResponseCodeDto.Success) {
      throw new Error(`Failed to get user portfolios: ${data.message}`);
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
    newDeploymentConfig: DeploymentConfigResponseDto,
    oldDeploymentConfig?: DeploymentConfigResponseDto,
  ): MetaTransactionData[] {
    const clearValidatorTxs =
      oldDeploymentConfig?.validators?.flatMap((validator) => {
        switch (validator.protocol) {
          case ValidatorProtocolDto.AaveV3: {
            const clearValidatorTxs = validator.targets.map((target) => ({
              to: oldDeploymentConfig.guard,
              data: encodeFunctionData({
                abi: OWLIA_GUARD_ABI,
                functionName: 'setValidator',
                args: [target, zeroAddress],
              }),
              value: '0',
            }));
            const clearAllowedAssetTxs = validator.markets.map((market) => ({
              to: validator.validator,
              data: encodeFunctionData({
                abi: AAVE_V3_OWLIA_VALIDATOR_ABI,
                functionName: 'setAllowedAsset',
                args: [market.contract, false],
              }),
              value: '0',
            }));
            return [...clearValidatorTxs, ...clearAllowedAssetTxs];
          }
          case ValidatorProtocolDto.EulerV2: {
            const clearValidatorTxs = validator.targets.map((target) => ({
              to: oldDeploymentConfig.guard,
              data: encodeFunctionData({
                abi: OWLIA_GUARD_ABI,
                functionName: 'setValidator',
                args: [target, zeroAddress],
              }),
              value: '0',
            }));
            const clearAllowedVaultTxs = validator.markets.map((market) => ({
              to: validator.validator,
              data: encodeFunctionData({
                abi: EULER_V2_OWLIA_VALIDATOR_ABI,
                functionName: 'setAllowedVault',
                args: [market.contract, false],
              }),
              value: '0',
            }));
            return [...clearValidatorTxs, ...clearAllowedVaultTxs];
          }
          case ValidatorProtocolDto.OkxSwap: {
            const clearValidatorTxs = validator.targets.map((target) => ({
              to: oldDeploymentConfig.guard,
              data: encodeFunctionData({
                abi: OWLIA_GUARD_ABI,
                functionName: 'setValidator',
                args: [target, zeroAddress],
              }),
              value: '0',
            }));
            const clearAllowedAssetTxs = validator.assets.map((asset) => ({
              to: validator.validator,
              data: encodeFunctionData({
                abi: OKX_SWAP_OWLIA_VALIDATOR_ABI,
                functionName: 'setAllowedToken',
                args: [asset.contract, false],
              }),
              value: '0',
            }));
            return [...clearValidatorTxs, ...clearAllowedAssetTxs];
          }
        }
      }) ?? [];

    const setValidatorTxs = newDeploymentConfig.validators.flatMap(
      (validator) => {
        switch (validator.protocol) {
          case ValidatorProtocolDto.AaveV3: {
            const setValidatorTxs = validator.targets.map((target) => ({
              to: newDeploymentConfig.guard,
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
              to: newDeploymentConfig.guard,
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
              to: newDeploymentConfig.guard,
              data: encodeFunctionData({
                abi: OWLIA_GUARD_ABI,
                functionName: 'setValidator',
                args: [target, validator.validator],
              }),
              value: '0',
            }));
            const setAllowedAssetTxs = validator.assets.map((asset) => ({
              to: validator.validator,
              data: encodeFunctionData({
                abi: OKX_SWAP_OWLIA_VALIDATOR_ABI,
                functionName: 'setAllowedToken',
                args: [asset.contract, true],
              }),
              value: '0',
            }));
            return [...setValidatorTxs, ...setAllowedAssetTxs];
          }
        }
      },
    );
    return [...clearValidatorTxs, ...setValidatorTxs];
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
