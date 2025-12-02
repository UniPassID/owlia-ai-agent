import {
  ContractFunctionReturnType,
  createPublicClient,
  http,
  type PublicClient,
} from 'viem';
import {
  AaveV3BorrowResponseDto,
  AaveV3ProtocolBlockResponseDto,
  AaveV3SupplyResponseDto,
} from '../dto/aave-v3.response.dto';
import { AAVE_V3_ABI } from '../../abis/aave-v3.abi';
import { AAVE_V3_DATA_PROVIDER_ABI } from '../../abis/aave-v3-data-provider.abi';
import { UnknownException } from '../../common/exceptions/base.exception';
import { Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { getChain, NetworkDto } from '../../common/dto/network.dto';
import { TokenPricesResponseDto } from '../../common/tracker-client';
import { fallback } from '../../common/fallback-transport';

const AAVE_POOL_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Bsc]: '0x6807dc923806fe8fd134338eabca509979a7e0cb',
  [NetworkDto.Base]: '0xa238dd80c259a72e81d7e4664a9801593f98d1c5',
};
const AAVE_DATA_PROVIDER_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Bsc]: '0x1e26247502e90b4fab9d0d17e4775e90085d2a35',
  [NetworkDto.Base]: '0x0f43731eb8d45a581f4a36dd74f5f358bc90c73a',
};

export type UserReserveData = ContractFunctionReturnType<
  typeof AAVE_V3_DATA_PROVIDER_ABI,
  'view',
  'getUserReserveData',
  [string, string]
>;

export type ReserveData = ContractFunctionReturnType<
  typeof AAVE_V3_DATA_PROVIDER_ABI,
  'view',
  'getReserveData',
  [string]
>;

export class AaveV3Manager {
  aavePoolAddress: string;
  aaveDataProviderAddress: string;

  private readonly client: PublicClient;
  private readonly logger: Logger = new Logger(AaveV3Manager.name);

  constructor(
    private readonly network: NetworkDto,
    private readonly rpcUrls: string[],
  ) {
    this.client = createPublicClient({
      chain: getChain(this.network),
      transport: fallback(this.rpcUrls.map((rpcUrl) => http(rpcUrl))),
    });

    this.aavePoolAddress = AAVE_POOL_ADDRESS[this.network];
    if (!this.aavePoolAddress) {
      throw new Error(
        `Aave pool address not found for network: ${this.network}`,
      );
    }

    this.aaveDataProviderAddress = AAVE_DATA_PROVIDER_ADDRESS[this.network];
    if (!this.aaveDataProviderAddress) {
      throw new Error(
        `Aave data provider address not found for network: ${this.network}`,
      );
    }
  }

  async getAaveV3AccountPortfolio(
    account: string,
    tokenPrices: TokenPricesResponseDto,
  ): Promise<AaveV3ProtocolBlockResponseDto> {
    const [accountResult, reservesResult] = await this.client.multicall({
      contracts: [
        {
          address: this.aavePoolAddress,
          abi: AAVE_V3_ABI,
          functionName: 'getUserAccountData',
          args: [account],
        },
        {
          address: this.aaveDataProviderAddress,
          abi: AAVE_V3_DATA_PROVIDER_ABI,
          functionName: 'getAllReservesTokens',
          args: [],
        },
      ],
    });

    if (accountResult.status === 'failure') {
      this.logger.error(`got account info failed: ${accountResult.error}`);
      throw new UnknownException();
    }

    const accountInfo = {
      totalCollateralBase: accountResult.result[0],
      totalDebtBase: accountResult.result[1],
      availableBorrowsBase: accountResult.result[2],
      currentLiquidationThreshold: accountResult.result[3],
      ltv: accountResult.result[4],
      healthFactor: accountResult.result[5],
    };

    if (reservesResult.status === 'failure') {
      this.logger.error(`got reserves failed: ${reservesResult.error}`);
      throw new UnknownException();
    }

    const reserves = reservesResult.result;

    const userReservesRets = await this.client.multicall({
      contracts: reserves.flatMap((reserve) => [
        {
          address: this.aaveDataProviderAddress,
          abi: AAVE_V3_DATA_PROVIDER_ABI,
          functionName: 'getUserReserveData',
          args: [reserve.tokenAddress, account],
        },
        {
          address: this.aaveDataProviderAddress,
          abi: AAVE_V3_DATA_PROVIDER_ABI,
          functionName: 'getReserveData',
          args: [reserve.tokenAddress],
        },
      ]),
    });

    const supplies: AaveV3SupplyResponseDto[] = [];
    const borrows: AaveV3BorrowResponseDto[] = [];
    let totalSupplyUSD = new Decimal(0);
    let totalBorrowUSD = new Decimal(0);

    for (let i = 0; i < userReservesRets.length; i += 2) {
      const userReserveDataRet = userReservesRets[i];
      if (userReserveDataRet.status === 'failure') {
        this.logger.error(
          `got user reserve data failed: ${userReserveDataRet.error}`,
        );
        throw new UnknownException();
      }

      const userReserveRawData =
        userReserveDataRet.result as unknown as UserReserveData;

      const userReserveData = {
        currentATokenBalance: userReserveRawData[0],
        currentStableDebt: userReserveRawData[1],
        currentVariableDebt: userReserveRawData[2],
        principalStableDebt: userReserveRawData[3],
        scaledVariableDebt: userReserveRawData[4],
        stableBorrowRate: userReserveRawData[5],
        liquidityRate: userReserveRawData[6],
        stableRateLastUpdated: userReserveRawData[7],
        usageAsCollateralEnabled: userReserveRawData[8],
      };

      const reserveDataRet = userReservesRets[i + 1];
      if (reserveDataRet.status === 'failure') {
        this.logger.error(`got reserve data failed: ${reserveDataRet.error}`);
        throw new UnknownException();
      }

      const reserveRawData = reserveDataRet.result as unknown as ReserveData;
      const reserveData = {
        unbacked: reserveRawData[0],
        accruedToTreasuryScaled: reserveRawData[1],
        totalAToken: reserveRawData[2],
        totalVariableDebt: reserveRawData[4],
        liquidityRate: reserveRawData[5],
        variableBorrowRate: reserveRawData[6],
        liquidityIndex: reserveRawData[9],
        variableBorrowIndex: reserveRawData[10],
        lastUpdateTimestamp: reserveRawData[11],
      };
      const reserve = reserves[i / 2];

      if (
        userReserveData.currentATokenBalance > 0n ||
        userReserveData.currentStableDebt > 0n ||
        userReserveData.currentVariableDebt > 0n
      ) {
        const tokenInfoWithPrice = tokenPrices.tokenPrices.find(
          (tokenPrice) =>
            tokenPrice.network === this.network &&
            tokenPrice.tokenAddress === reserve.tokenAddress,
        );

        if (tokenInfoWithPrice) {
          if (userReserveData.currentATokenBalance > 0n) {
            const supplyAPY = this.convertRateToAPY(reserveData.liquidityRate);
            const supplyAmount = new Decimal(
              userReserveData.currentATokenBalance,
            ).div(new Decimal(10).pow(tokenInfoWithPrice.tokenDecimals));
            const supplyAmountUsd = supplyAmount.mul(tokenInfoWithPrice.bid);

            supplies.push({
              tokenAddress: reserve.tokenAddress,
              amount: supplyAmount.toString(),
              amountUsd: supplyAmountUsd.toString(),
              supplyApy: supplyAPY.toString(),
              usageAsCollateralEnabled:
                userReserveData.usageAsCollateralEnabled,
            });

            totalSupplyUSD = totalSupplyUSD.add(supplyAmountUsd);
          }

          if (userReserveData.currentStableDebt > 0n) {
            const borrowAmount = new Decimal(
              userReserveData.currentStableDebt,
            ).div(new Decimal(10).pow(tokenInfoWithPrice.tokenDecimals));
            const borrowAmountUsd = borrowAmount.mul(tokenInfoWithPrice.bid);

            const borrowAPY = this.convertRateToAPY(
              userReserveData.stableBorrowRate,
            ); // stableBorrowRate

            borrows.push({
              tokenAddress: reserve.tokenAddress,
              amount: borrowAmount.toString(),
              amountUsd: borrowAmountUsd.toString(),
              borrowApy: borrowAPY.toString(),
            });

            totalBorrowUSD = totalBorrowUSD.add(borrowAmountUsd);
          }

          if (userReserveData.currentVariableDebt > 0n) {
            const borrowAmount = new Decimal(
              userReserveData.currentVariableDebt,
            ).div(new Decimal(10).pow(tokenInfoWithPrice.tokenDecimals));
            const borrowAmountUsd = borrowAmount.mul(tokenInfoWithPrice.bid);

            const borrowAPY = this.convertRateToAPY(
              reserveData.variableBorrowRate,
            );

            borrows.push({
              tokenAddress: reserve.tokenAddress,
              amount: borrowAmount.toString(),
              amountUsd: borrowAmountUsd.toString(),
              borrowApy: borrowAPY.toString(),
            });

            totalBorrowUSD = totalBorrowUSD.add(borrowAmountUsd);
          }
        }
      }
    }

    const totalNetWorthUsd = totalSupplyUSD.sub(totalBorrowUSD);

    const totalApy = totalNetWorthUsd.gt(0)
      ? supplies
          .reduce((acc, supply) => {
            return acc.add(new Decimal(supply.amountUsd).mul(supply.supplyApy));
          }, new Decimal(0))
          .sub(
            borrows.reduce((acc, borrow) => {
              return acc.add(
                new Decimal(borrow.amountUsd).mul(borrow.borrowApy),
              );
            }, new Decimal(0)),
          )
          .div(totalNetWorthUsd)
      : new Decimal(0);

    const aaveV3ProtocolBlock: AaveV3ProtocolBlockResponseDto = {
      id: 'aave-v3',
      name: 'Aave',
      version: 'v3',
      assetUsd: totalSupplyUSD.toString(),
      debtUsd: totalBorrowUSD.toString(),
      netUsd: totalNetWorthUsd.toString(),
      claimableUsd: '0',
      totalCollateralUsd: totalSupplyUSD.toString(),
      totalDebtUsd: totalBorrowUSD.toString(),
      healthFactor: accountInfo.healthFactor.toString(),
      ltv: accountInfo.ltv.toString(),
      liquidationThreshold: accountInfo.currentLiquidationThreshold.toString(),
      netApy: totalApy.toString(),
      supplied: supplies,
      borrowed: borrows,
      rewards: [],
    };

    return aaveV3ProtocolBlock;
  }

  convertRateToAPY(rate: bigint): Decimal {
    const RAY = 10 ** 27;

    const ratePerYear = new Decimal(rate).div(RAY);

    return ratePerYear.mul(100);
  }
}
