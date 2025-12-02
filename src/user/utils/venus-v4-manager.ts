import { createPublicClient, http, PublicClient } from 'viem';
import { getChain, NetworkDto } from '../../common/dto/network.dto';
import { fallback } from '../../common/fallback-transport';
import {
  VenusV4BorrowResponseDto,
  VenusV4ProtocolBlockResponseDto,
  VenusV4RewardsResponseDto,
  VenusV4SupplyResponseDto,
} from '../dto/venus-v4.response.dto';
import { VENUS_V4_COMPTROLLER_ABI } from '../../abis/venus-v4-comptroller.abi';
import { Logger } from '@nestjs/common';
import { VENUS_V4_LENS_ABI } from '../../abis/venus-v4-lens.abi';
import { UnknownException } from '../../common/exceptions/base.exception';
import Decimal from 'decimal.js';
import { TokenPricesResponseDto } from '../../common/tracker-client';

const COMPTROLLER_ADDRESS: Record<NetworkDto, string | null> = {
  [NetworkDto.Bsc]: '0xfd36e2c2a6789db23113685031d7f16329158384',
  [NetworkDto.Base]: null,
};

const LENS_ADDRESS: Record<NetworkDto, string | null> = {
  [NetworkDto.Bsc]: '0xe4c455cbf870a86399043b8a36a669ffa1583e95',
  [NetworkDto.Base]: null,
};

export class VenusV4Manager {
  comptrollerAddress: string;
  lensAddress: string;

  private readonly client: PublicClient;
  private readonly logger: Logger = new Logger(VenusV4Manager.name);

  constructor(
    private readonly network: NetworkDto,
    private readonly rpcUrls: string[],
  ) {
    const comptrollerAddress = COMPTROLLER_ADDRESS[network];
    if (!comptrollerAddress) {
      throw new Error(
        `Venus V4 comptroller address not found for network: ${network}`,
      );
    }
    this.comptrollerAddress = comptrollerAddress;

    const lensAddress = LENS_ADDRESS[network];
    if (!lensAddress) {
      throw new Error(
        `Venus V4 lens address not found for network: ${network}`,
      );
    }
    this.lensAddress = lensAddress;

    this.client = createPublicClient({
      chain: getChain(this.network),
      transport: fallback(this.rpcUrls.map((rpcUrl) => http(rpcUrl))),
    });
  }

  async getVenusV4AccountPortfolio(
    account: string,
    prices: TokenPricesResponseDto,
  ): Promise<VenusV4ProtocolBlockResponseDto> {
    const markets = await this.client.readContract({
      address: this.comptrollerAddress,
      abi: VENUS_V4_COMPTROLLER_ABI,
      functionName: 'getAllMarkets',
    });

    const [vTokenBalancesAllRet, vTokenMetadataAllRet, accountLimitsRet] =
      await this.client.multicall({
        contracts: [
          {
            address: this.lensAddress,
            abi: VENUS_V4_LENS_ABI,
            functionName: 'vTokenBalancesAll',
            args: [markets, account],
          },
          {
            address: this.lensAddress,
            abi: VENUS_V4_LENS_ABI,
            functionName: 'vTokenMetadataAll',
            args: [markets],
          },
          {
            address: this.lensAddress,
            abi: VENUS_V4_LENS_ABI,
            functionName: 'getAccountLimits',
            args: [this.comptrollerAddress, account],
          },
        ],
      });

    if (vTokenBalancesAllRet.status !== 'success') {
      this.logger.error(
        `got vTokenBalancesAll failed: ${vTokenBalancesAllRet.error}`,
      );
      throw new UnknownException();
    }

    const vTokenBalancesAll = vTokenBalancesAllRet.result;
    if (vTokenMetadataAllRet.status !== 'success') {
      this.logger.error(
        `got vTokenMetadataAll failed: ${vTokenMetadataAllRet.error}`,
      );
      throw new UnknownException();
    }
    const vTokenMetadataAll = vTokenMetadataAllRet.result;

    if (accountLimitsRet.status !== 'success') {
      this.logger.error(`got accountLimits failed: ${accountLimitsRet.error}`);
      throw new UnknownException();
    }
    const accountLimits = accountLimitsRet.result;

    const metadataMap = new Map<string, any>();
    for (const meta of vTokenMetadataAll) {
      metadataMap.set(meta.vToken, meta);
    }

    const supplies: VenusV4SupplyResponseDto[] = [];
    const borrows: VenusV4BorrowResponseDto[] = [];
    const rewards: VenusV4RewardsResponseDto[] = [];

    let totalSupplyUSD = new Decimal(0);
    let totalBorrowUSD = new Decimal(0);
    let totalCollateralUSD = new Decimal(0);
    let totalRawCollateralUSD = new Decimal(0);

    for (let i = 0; i < vTokenBalancesAll.length; i++) {
      const balance = vTokenBalancesAll[i];
      const vTokenAddress = balance.vToken;
      const meta = metadataMap.get(vTokenAddress);

      if (!meta || !meta.isListed) continue;

      const tokenInfoWithPrice = prices.tokenPrices.find(
        (tokenPrice) =>
          tokenPrice.network === this.network &&
          tokenPrice.tokenAddress === meta.underlyingAssetAddress,
      );
      if (!tokenInfoWithPrice) {
        this.logger.warn(
          `Token info with price not found for address: ${meta.underlyingAssetAddress}`,
        );
        continue;
      }

      // 计算 APY (年化)
      const blocksPerYear = 20n * 60n * 24n * 365n; // BSC: 约 20 个区块/分钟
      const supplyAPY = calculateAPY(meta.supplyRatePerBlock, blocksPerYear);
      const borrowAPY = calculateAPY(meta.borrowRatePerBlock, blocksPerYear);

      // 处理存款
      if (balance.balanceOfUnderlying > 0n) {
        const supplyAmount = new Decimal(balance.balanceOfUnderlying).div(
          new Decimal(10).pow(tokenInfoWithPrice.tokenDecimals),
        );
        const supplyAmountUsd = supplyAmount.mul(tokenInfoWithPrice.bid);

        // 检查是否作为抵押品
        const isCollateral = accountLimits.markets.includes(balance.vToken);
        const collateralFactor = new Decimal(meta.collateralFactorMantissa).div(
          1e18,
        );

        if (isCollateral) {
          totalCollateralUSD = totalCollateralUSD.add(
            supplyAmountUsd.mul(collateralFactor),
          );
          totalRawCollateralUSD = totalRawCollateralUSD.add(supplyAmountUsd);
        }

        supplies.push({
          tokenAddress: meta.underlyingAssetAddress,
          amount: supplyAmount.toString(),
          amountUsd: supplyAmountUsd.toString(),
          supplyApy: supplyAPY.toString(),
          usageAsCollateralEnabled: isCollateral,
        });

        totalSupplyUSD = totalSupplyUSD.add(supplyAmountUsd);
      }

      // 处理借款
      if (balance.borrowBalanceCurrent > 0n) {
        const borrowAmount = new Decimal(balance.borrowBalanceCurrent).div(
          new Decimal(10).pow(tokenInfoWithPrice.tokenDecimals),
        );
        const borrowAmountUsd = borrowAmount.mul(tokenInfoWithPrice.bid);

        borrows.push({
          tokenAddress: meta.underlyingAssetAddress,
          amount: borrowAmount.toString(),
          amountUsd: borrowAmountUsd.toString(),
          borrowApy: borrowAPY.toString(),
        });

        totalBorrowUSD = totalBorrowUSD.add(borrowAmountUsd);
      }
    }

    // 计算健康因子
    let healthFactor = new Decimal(0);
    if (totalBorrowUSD.gt(0)) {
      healthFactor = totalCollateralUSD.div(totalBorrowUSD);
    } else if (totalSupplyUSD.gt(0)) {
      healthFactor = new Decimal(999); // 无借款
    }

    const ltv = totalCollateralUSD.gt(0)
      ? totalBorrowUSD.div(totalCollateralUSD)
      : null;
    const liquidationThreshold = totalRawCollateralUSD.gt(0)
      ? totalCollateralUSD.div(totalRawCollateralUSD)
      : null;

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

    return {
      id: 'venus-v4',
      name: 'Venus',
      version: 'v4',
      assetUsd: totalSupplyUSD.toString(),
      debtUsd: totalBorrowUSD.toString(),
      netUsd: totalNetWorthUsd.toString(),
      claimableUsd: '0',
      totalCollateralUsd: totalCollateralUSD.toString(),
      totalDebtUsd: totalBorrowUSD.toString(),
      healthFactor: healthFactor.toString(),
      ltv: ltv?.toString() || '0',
      liquidationThreshold: liquidationThreshold?.toString() || '0',
      netApy: totalApy.toString(),
      supplied: supplies,
      borrowed: borrows,
      rewards: rewards,
    };
  }
}

function calculateAPY(ratePerBlock: bigint, blocksPerYear: bigint): Decimal {
  const ratePerBlockNumber = new Decimal(ratePerBlock).div(1e18);
  const apy = ratePerBlockNumber.add(1).pow(blocksPerYear).sub(1).mul(100);
  return apy;
}

export const VENUS_V4_CORE_POOL_ASSETS: Record<string, string> = {
  // Native BNB (special case)
  '0x0000000000000000000000000000000000000000': 'BNB',

  // Stablecoins
  '0x55d398326f99059fF775485246999027B3197955': 'USDT',
  '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d': 'USDC',
  '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56': 'BUSD',
  '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3': 'DAI',
  '0x40af3827F39D0EAcBF4A168f8D4ee67c121D11c9': 'TUSD',
  '0x14016E85a25aeb13065688cAFB43044C2ef86784': 'TUSDOLD',
  '0x3d4350cD54aeF9f9b2C29435e0fa809957B3F30a': 'UST',
  '0x4BD17003473389A42DAF6a0a729f6Fdb328BbBd7': 'VAI',
  '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409': 'FDUSD',
  '0x0782b6d8c4551B9760e74c0545a9bCD90bdc41E5': 'lisUSD',
  '0x211Cc4DD073734dA055fbF44a2b4667d5E5fE5d2': 'sUSDe',
  '0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34': 'USDe',
  '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d': 'USD1',

  // Major Cryptos
  '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c': 'BTCB',
  '0x2170Ed0880ac9A755fd29B2688956BD959F933F8': 'ETH',
  '0x250632378E573c6Be1AC2f97Fcdf00515d0Aa91B': 'BETH',
  '0xa2e3356610840701bdf5611a53974510ae27e2e1': 'WBETH',
  '0x77734e70b6E88b4d82fE632a168EDf6e700912b6': 'asBNB',

  // DeFi Tokens
  '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82': 'CAKE',
  '0xBf5140A22578168FD562DCcF235E5D43A02ce9B1': 'UNI',
  '0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD': 'LINK',
  '0xfb6115445Bff7b52FeB98650C87f44907E58f802': 'AAVE',
  '0x47BEAd2563dCBf3bF2c9407fEa4dC236fAbA485A': 'SXP',
  '0x4B0F1812e5Df2A09796481Ff14017e6005508003': 'TWT',
  '0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63': 'XVS',

  // Other L1/L2 Tokens
  '0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402': 'DOT',
  '0xCC42724C6683B7E57334c4E856f4c9965ED682bD': 'MATIC',
  '0x570A5D26f7765Ecb712C0924E4De545B89fD43dF': 'SOL',
  '0xCE7de646e7208a4Ef112cb6ed5038FA6cC6b12e3': 'TRX',
  '0x85EAC5Ac2F758618dFa09bDbe0cf174e7d574D5B': 'TRXOLD',
  '0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47': 'ADA',
  '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE': 'XRP',

  // Other Altcoins
  '0x8fF795a6F4D97E7887C79beA79aba5cc76444aDf': 'BCH',
  '0x4338665CBB7B2485A8855A139b75D5e34AB0DB94': 'LTC',
  '0xbA2aE424d960c26247Dd6c32edC70B295c744C43': 'DOGE',
  '0x0D8Ce2A99Bb6e3B7Db580eD848240e4a0F9aE153': 'FIL',
  '0x156ab3346823B651294766e23e6Cf87254d68962': 'LUNA',
  '0xF4C8E32EaDEC4BFe97E0F595AdD0f4450a863a11': 'THE',

  // BTC Variants
  '0x4aae823a6a0b376De6A78e74eCC5b079d38cBCf7': 'SolvBTC',
  '0x1346b618dC92810EC74163e4c27004c921D446a5': 'xSolvBTC',

  // PT Token
  '0xDD809435ba6c9d6903730f923038801781cA66ce': 'PT-sUSDE-26JUN2025',
};
