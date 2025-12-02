import {
  createPublicClient,
  getAddress,
  http,
  PublicClient,
  type ContractFunctionReturnType,
} from 'viem';
import { getChain, NetworkDto } from '../../../../common/dto/network.dto';
import { fallback } from '../../../../common/fallback-transport';
import {
  EulerV2ProtocolBlockResponseDto,
  EulerV2SubAccountResponseDto,
} from '../dto/euler-v2.response.dto';
import { EULER_V2_UTILS_LENS_ABI } from '../../../../abis/euler-v2-utils-lens.abi';
import { Logger } from '@nestjs/common';
import { UnknownException } from '../../../../common/exceptions/base.exception';
import { EULER_V2_GOVERNED_PERSPECTIVE_ABI } from '../../../../abis/euler-v2-governed-perspective.abi';
import { EULER_V2_ACCOUNT_LENS_ABI } from '../../../../abis/euler-v2-account-lens.abi';
import Decimal from 'decimal.js';
import {
  EULER_V2_UTILS_LENS_ADDRESS,
  EULER_V2_ACCOUNT_LENS_ADDRESS,
  EULER_V2_EVC_ADDRESS,
  EULER_V2_GOVERNED_PERSPECTIVE_ADDRESS,
} from '../../../../common/constants';
import { TokenPricesResponseDto } from '../../../tracker/dto/token-price.response';

type GetVaultAccountInfoReturnType = ContractFunctionReturnType<
  typeof EULER_V2_ACCOUNT_LENS_ABI,
  'view',
  'getVaultAccountInfo',
  [string, string]
>;

type EulerVaultAccountInfo = {
  subAccount: string;
  subAccountId: number;
  vaultInfo: GetVaultAccountInfoReturnType;
};

type GetAccountEnabledVaultsInfoReturnType = ContractFunctionReturnType<
  typeof EULER_V2_ACCOUNT_LENS_ABI,
  'view',
  'getAccountEnabledVaultsInfo',
  [string, string]
>;

export class EulerV2Manager {
  accountLensAddress: string;
  evAddress: string;
  governedPerspectiveAddress: string;
  utilsLensAddress: string;

  private readonly client: PublicClient;
  private readonly logger: Logger = new Logger(EulerV2Manager.name);

  constructor(
    private readonly network: NetworkDto,
    private readonly rpcUrls: string[],
  ) {
    this.accountLensAddress = EULER_V2_ACCOUNT_LENS_ADDRESS[network];
    this.evAddress = EULER_V2_EVC_ADDRESS[network];
    this.governedPerspectiveAddress =
      EULER_V2_GOVERNED_PERSPECTIVE_ADDRESS[network];
    this.utilsLensAddress = EULER_V2_UTILS_LENS_ADDRESS[network];

    this.client = createPublicClient({
      chain: getChain(this.network),
      transport: fallback(this.rpcUrls.map((rpcUrl) => http(rpcUrl))),
    });
  }

  async getEulerAccountPortfolio(
    account: string,
    prices: TokenPricesResponseDto,
  ): Promise<EulerV2ProtocolBlockResponseDto> {
    const [mainAccountVaultInfos, subAccountsVaultInfos] = await Promise.all([
      this.getEulerMainAccountVaultInfos(account),
      this.getEulerSubAccountsVaultInfos(account),
    ]);
    const vaultInfos: EulerVaultAccountInfo[] = [
      ...mainAccountVaultInfos,
      ...subAccountsVaultInfos,
    ];
    const positions = await this.getEulerAccountPositions(vaultInfos, prices);
    return {
      id: 'euler-v2',
      name: 'Euler',
      version: 'v2',
      assetUsd: positions.positions
        .reduce(
          (acc, position) => acc.add(position.supplyAmountUsd),
          new Decimal(0),
        )
        .toString(),
      debtUsd: positions.positions
        .reduce(
          (acc, position) => acc.add(position.borrowAmountUsd),
          new Decimal(0),
        )
        .toString(),
      netUsd: positions.positions
        .reduce(
          (acc, position) =>
            acc.add(position.supplyAmountUsd).sub(position.borrowAmountUsd),
          new Decimal(0),
        )
        .toString(),
      claimableUsd: new Decimal(0).toString(),
      positions: positions.positions,
      subAccounts: positions.subAccounts,
    };
  }

  async getEulerMainAccountVaultInfos(
    account: string,
  ): Promise<EulerVaultAccountInfo[]> {
    const verifiedVaults = await this.client.readContract({
      address: this.governedPerspectiveAddress,
      abi: EULER_V2_GOVERNED_PERSPECTIVE_ABI,
      functionName: 'verifiedArray',
    });

    const vaultAccountInfoRets = await this.client.multicall({
      contracts: verifiedVaults.map((vault) => ({
        address: this.accountLensAddress,
        abi: EULER_V2_ACCOUNT_LENS_ABI,
        functionName: 'getVaultAccountInfo',
        args: [account, vault],
      })),
    });

    const vaultAccountInfos = vaultAccountInfoRets
      .map((ret) => {
        if (ret.status !== 'success') {
          this.logger.error(`Failed to get vault account info`);
          throw new UnknownException();
        }

        const result = ret.result as unknown as GetVaultAccountInfoReturnType;
        return {
          subAccount: account,
          subAccountId: 0,
          vaultInfo: result,
        };
      })
      .filter((info) => {
        return info.vaultInfo.assets > 0n || info.vaultInfo.borrowed > 0n;
      });

    return vaultAccountInfos;
  }

  async getEulerSubAccountsVaultInfos(
    account: string,
  ): Promise<EulerVaultAccountInfo[]> {
    const subAccounts: string[] = Array.from({ length: 10 }, (_, i) =>
      this.deriveEulerV2SubaccountAddress(account, i + 1),
    );

    const subAccountsDataRets = await this.client.multicall({
      contracts: subAccounts.map((subAccount) => ({
        address: this.accountLensAddress,
        abi: EULER_V2_ACCOUNT_LENS_ABI,
        functionName: 'getAccountEnabledVaultsInfo',
        args: [this.evAddress, subAccount],
      })),
    });

    const subAccountVaultInfos = subAccountsDataRets
      .map((ret, index) => {
        const subAccount = subAccounts[index];
        const subAccountId = index + 1;

        if (ret.status !== 'success') {
          this.logger.error(`Failed to get sub account enabled vaults info`);
          throw new UnknownException();
        }

        const result =
          ret.result as unknown as GetAccountEnabledVaultsInfoReturnType;

        const vaultInfos = result.vaultAccountInfo.map((vaultInfo) => {
          return {
            subAccount: subAccount,
            subAccountId: subAccountId,
            vaultInfo: vaultInfo,
          };
        });
        return vaultInfos;
      })
      .flat()
      .filter((info) => {
        return info.vaultInfo.assets > 0n || info.vaultInfo.borrowed > 0n;
      });
    return subAccountVaultInfos;
  }

  async getEulerAccountPositions(
    vaultAccountInfos: EulerVaultAccountInfo[],
    prices: TokenPricesResponseDto,
  ): Promise<
    Pick<EulerV2ProtocolBlockResponseDto, 'positions' | 'subAccounts'>
  > {
    const vaults = Array.from(
      new Set<string>(
        vaultAccountInfos.map((vaultAccountInfo) => {
          return vaultAccountInfo.vaultInfo.vault;
        }),
      ),
    );

    const apyRets = await this.client.multicall({
      contracts: vaults.map((vault) => {
        return {
          address: this.utilsLensAddress,
          abi: EULER_V2_UTILS_LENS_ABI,
          functionName: 'getAPYs',
          args: [vault],
        };
      }),
    });

    const apysMap = apyRets.reduce((acc, ret, index) => {
      if (ret.status !== 'success') {
        this.logger.error(`Failed to get APYs for vault`);
        throw new UnknownException();
      }
      acc.set(vaults[index], {
        borrowAPY: ret.result[0],
        supplyAPY: ret.result[1],
      });
      return acc;
    }, new Map<string, { borrowAPY: bigint; supplyAPY: bigint }>());

    const subAccountsMap = new Map<
      number,
      {
        collateralValueUsd: Decimal;
        liabilityValueUsd: Decimal;
        netApyDivisor: Decimal;
        netApyDividend: Decimal;
      }
    >();

    const positions = vaultAccountInfos
      .map((vaultAccountInfo) => {
        const asset = vaultAccountInfo.vaultInfo.asset;
        const tokenInfoWithPrice = prices.tokenPrices.find(
          (token) =>
            token.network === this.network && token.tokenAddress === asset,
        );
        if (!tokenInfoWithPrice) {
          this.logger.warn(
            `Token info with price not found for asset ${asset}`,
          );
          return null;
        }
        let supplyAmount = new Decimal(0);
        let supplyAmountUsd = new Decimal(0);
        let borrowAmount = new Decimal(0);
        let borrowAmountUsd = new Decimal(0);
        const collateralValueBorrowing = new Decimal(
          vaultAccountInfo.vaultInfo.liquidityInfo.collateralValueBorrowing,
        );
        const collateralValueLiquidation = new Decimal(
          vaultAccountInfo.vaultInfo.liquidityInfo.collateralValueLiquidation,
        );
        const liabilityValue = new Decimal(
          vaultAccountInfo.vaultInfo.liquidityInfo.liabilityValue,
        );

        const collateralFactor = calculateHealthFactor(
          collateralValueBorrowing,
          liabilityValue,
        );
        const liquidationFactor = calculateHealthFactor(
          collateralValueLiquidation,
          liabilityValue,
        );
        let supplyApy = new Decimal(0);
        let borrowApy = new Decimal(0);
        if (vaultAccountInfo.vaultInfo.assets > 0n) {
          const apy = apysMap.get(vaultAccountInfo.vaultInfo.vault) || {
            borrowAPY: 0n,
            supplyAPY: 0n,
          };
          supplyAmount = new Decimal(vaultAccountInfo.vaultInfo.assets).div(
            10n ** BigInt(tokenInfoWithPrice.tokenDecimals),
          );
          supplyAmountUsd = supplyAmount.mul(tokenInfoWithPrice.bid);
          supplyApy = new Decimal(apy.supplyAPY).div(1e27).mul(100);
        }
        if (vaultAccountInfo.vaultInfo.borrowed > 0n) {
          const apy = apysMap.get(vaultAccountInfo.vaultInfo.vault) || {
            borrowAPY: 0n,
            supplyAPY: 0n,
          };
          borrowAmount = new Decimal(vaultAccountInfo.vaultInfo.borrowed).div(
            10n ** BigInt(tokenInfoWithPrice.tokenDecimals),
          );
          borrowAmountUsd = borrowAmount.mul(tokenInfoWithPrice.bid);
          borrowApy = new Decimal(apy.borrowAPY).div(1e27).mul(100);
        }

        const subAccountId = vaultAccountInfo.subAccountId;
        let subAccount = subAccountsMap.get(subAccountId);
        if (!subAccount) {
          subAccount = {
            collateralValueUsd: new Decimal(0),
            liabilityValueUsd: new Decimal(0),
            netApyDivisor: new Decimal(0),
            netApyDividend: new Decimal(0),
          };
        }

        subAccount.collateralValueUsd =
          subAccount.collateralValueUsd.add(borrowAmountUsd);
        subAccount.liabilityValueUsd =
          subAccount.liabilityValueUsd.add(supplyAmountUsd);
        subAccount.netApyDividend = subAccount.netApyDividend
          .add(supplyAmountUsd.mul(supplyApy))
          .sub(borrowAmountUsd.mul(borrowApy));
        subAccount.netApyDivisor = subAccount.netApyDivisor
          .add(supplyAmountUsd)
          .sub(borrowAmountUsd);
        subAccountsMap.set(subAccountId, subAccount);

        return {
          subAccountId: vaultAccountInfo.subAccountId,
          vault: vaultAccountInfo.vaultInfo.vault,
          underlying: vaultAccountInfo.vaultInfo.asset,
          debtToken: vaultAccountInfo.vaultInfo.asset,
          supplyAmount: supplyAmount.toString(),
          supplyAmountUsd: supplyAmountUsd.toString(),
          supplyApy: supplyApy.toString(),
          borrowAmount: borrowAmount.toString(),
          borrowAmountUsd: borrowAmountUsd.toString(),
          borrowApy: borrowApy.toString(),
          collateralFactor: collateralFactor.toString(),
          liquidationFactor: liquidationFactor.toString(),
        };
      })
      .filter((position) => position !== null);

    const subAccounts = [...subAccountsMap.entries()].map(
      ([subAccountId, subAccount]): EulerV2SubAccountResponseDto => {
        return {
          subAccountId: Number(subAccountId),
          collateralValueUsd: subAccount.collateralValueUsd.toString(),
          liabilityValueUsd: subAccount.liabilityValueUsd.toString(),
          healthScore: calculateHealthFactor(
            subAccount.collateralValueUsd,
            subAccount.liabilityValueUsd,
          ).toString(),
          netApy: subAccount.netApyDividend
            .div(subAccount.netApyDivisor)
            .toString(),
        };
      },
    );

    return {
      positions,
      subAccounts,
    };
  }

  // Helper function to derive subaccount address using XOR
  deriveEulerV2SubaccountAddress(
    mainAddress: string,
    subaccountId: number,
  ): string {
    const accountBN = BigInt(mainAddress);
    const subaccount = accountBN ^ BigInt(subaccountId);

    const hexAddress = '0x' + subaccount.toString(16).padStart(40, '0');

    return getAddress(hexAddress);
  }
}

function calculateHealthFactor(
  collateralValue: Decimal,
  liabilityValue: Decimal,
): Decimal {
  if (liabilityValue.eq(0)) return new Decimal(999); // No debt means infinite health
  return collateralValue.div(liabilityValue);
}
