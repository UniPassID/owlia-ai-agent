import { Logger } from '@nestjs/common';
import { getChain, getChainId, NetworkDto } from '../../common/dto/network.dto';
import {
  PortfolioResponseDto,
  PortfolioTokenResponseDto,
} from '../dto/portfolio.response.dto';
import { AaveV3Manager } from './aave-v3-manager';
import { AerodromeCLManager } from './aerodrome-cl-manager';
import { EulerV2Manager } from './euler-v2-manager';
import { UniswapV3Manager } from './uniswap-v3-manager';
import { VenusV4Manager } from './venus-v4-manager';
import {
  TokenPricesResponseDto,
  TrackerClient,
} from '../../common/tracker-client';
import { createPublicClient, http, PublicClient } from 'viem';
import { fallback } from '../../common/fallback-transport';
import { ERC20_ABI } from '../abis/erc-20.abi';
import { UnknownException } from '../../common/exceptions/base.exception';
import Decimal from 'decimal.js';

const DEFAULT_TOKENS: Record<NetworkDto, string[]> = {
  [NetworkDto.Bsc]: [
    '0x55d398326f99059fF775485246999027B3197955',
    '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  ],
  [NetworkDto.Base]: [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  ],
};

export class UserChainManager {
  uniswapV3Manager: UniswapV3Manager | null = null;
  aerodromeCLManager: AerodromeCLManager | null = null;
  aaveV3Manager: AaveV3Manager | null = null;
  eulerV2Manager: EulerV2Manager | null = null;
  venusV4Manager: VenusV4Manager | null = null;

  allowedTokens: string[];

  private readonly logger: Logger = new Logger(UserChainManager.name);
  private readonly trackerClient: TrackerClient;
  private readonly client: PublicClient;

  constructor(
    private readonly network: NetworkDto,
    private readonly rpcUrls: string[],
    private readonly trackerUrl: string,
  ) {
    try {
      this.uniswapV3Manager = new UniswapV3Manager(this.network, this.rpcUrls);
    } catch (error) {
      this.logger.warn(`Failed to create UniswapV3Manager: ${error}`);
    }
    try {
      this.aerodromeCLManager = new AerodromeCLManager(
        this.network,
        this.rpcUrls,
      );
    } catch (error) {
      this.logger.warn(`Failed to create AerodromeCLManager: ${error}`);
    }
    try {
      this.aaveV3Manager = new AaveV3Manager(this.network, this.rpcUrls);
    } catch (error) {
      this.logger.warn(`Failed to create AaveV3Manager: ${error}`);
    }
    try {
      this.eulerV2Manager = new EulerV2Manager(this.network, this.rpcUrls);
    } catch (error) {
      this.logger.warn(`Failed to create EulerV2Manager: ${error}`);
    }
    try {
      this.venusV4Manager = new VenusV4Manager(this.network, this.rpcUrls);
    } catch (error) {
      this.logger.warn(`Failed to create VenusV4Manager: ${error}`);
    }

    const allowedTokens = DEFAULT_TOKENS[network];
    if (!allowedTokens) {
      throw new Error(`No allowed tokens for network ${network}`);
    }
    this.allowedTokens = allowedTokens;

    this.trackerClient = new TrackerClient(this.trackerUrl);
    this.client = createPublicClient({
      chain: getChain(this.network),
      transport: fallback(this.rpcUrls.map((rpcUrl) => http(rpcUrl))),
    });
  }

  async getUserPortfolio(account: string): Promise<PortfolioResponseDto> {
    const tokenPrices = await this.trackerClient.tokenPrices({
      tokens: this.allowedTokens.map((token) => ({
        network: this.network,
        tokenAddress: token,
      })),
    });

    const [
      uniswapV3Portfolio,
      aerodromeCLPortfolio,
      aaveV3Portfolio,
      eulerV2Portfolio,
      venusV4Portfolio,
      walletPortfolio,
    ] = await Promise.all([
      this.uniswapV3Manager?.getUserUniswapV3Portfolio(account, tokenPrices),
      this.aerodromeCLManager?.getAerodromeCLAccountPortfolio(
        account,
        tokenPrices,
      ),
      this.aaveV3Manager?.getAaveV3AccountPortfolio(account, tokenPrices),
      this.eulerV2Manager?.getEulerAccountPortfolio(account, tokenPrices),
      this.venusV4Manager?.getVenusV4AccountPortfolio(account, tokenPrices),
      this.getUserWalletPortfolio(account, tokenPrices),
    ]);

    const netUsd = walletPortfolio.wallet
      .reduce((acc, wallet) => {
        return acc.add(new Decimal(wallet.amountUsd));
      }, new Decimal(0))
      .add(uniswapV3Portfolio?.netUsd ?? 0)
      .add(aerodromeCLPortfolio?.netUsd ?? 0)
      .add(aaveV3Portfolio?.netUsd ?? 0)
      .add(eulerV2Portfolio?.netUsd ?? 0)
      .add(venusV4Portfolio?.netUsd ?? 0);

    const walletUsd = walletPortfolio.wallet.reduce((acc, wallet) => {
      return acc.add(new Decimal(wallet.amountUsd));
    }, new Decimal(0));

    const assetUsd = walletUsd
      .add(uniswapV3Portfolio?.assetUsd ?? 0)
      .add(aerodromeCLPortfolio?.assetUsd ?? 0)
      .add(aaveV3Portfolio?.assetUsd ?? 0)
      .add(eulerV2Portfolio?.assetUsd ?? 0)
      .add(venusV4Portfolio?.assetUsd ?? 0);

    const defiUsd = new Decimal(0)
      .add(uniswapV3Portfolio?.assetUsd ?? 0)
      .add(aerodromeCLPortfolio?.assetUsd ?? 0)
      .add(aaveV3Portfolio?.assetUsd ?? 0)
      .add(eulerV2Portfolio?.assetUsd ?? 0)
      .add(venusV4Portfolio?.assetUsd ?? 0);

    const debtUsd = new Decimal(0)
      .add(uniswapV3Portfolio?.debtUsd ?? 0)
      .add(aerodromeCLPortfolio?.debtUsd ?? 0)
      .add(aaveV3Portfolio?.debtUsd ?? 0)
      .add(eulerV2Portfolio?.debtUsd ?? 0)
      .add(venusV4Portfolio?.debtUsd ?? 0);
    const claimableUsd = new Decimal(0)
      .add(uniswapV3Portfolio?.claimableUsd ?? 0)
      .add(aerodromeCLPortfolio?.claimableUsd ?? 0)
      .add(aaveV3Portfolio?.claimableUsd ?? 0)
      .add(eulerV2Portfolio?.claimableUsd ?? 0)
      .add(venusV4Portfolio?.claimableUsd ?? 0);

    return {
      meta: {
        network: this.network,
        chainId: getChainId(this.network),
        address: account,
      },
      summary: {
        netUsd: netUsd.toString(),
        assetUsd: assetUsd.toString(),
        debtUsd: debtUsd.toString(),
        walletUsd: walletUsd.toString(),
        defiUsd: defiUsd.toString(),
        claimableUsd: claimableUsd.toString(),
      },
      tokens: tokenPrices.tokenPrices.reduce(
        (acc, token) => {
          acc[token.tokenAddress] = {
            symbol: token.tokenSymbol,
            name: token.tokenSymbol,
            decimals: token.tokenDecimals,
            priceUsd: token.bid,
          };
          return acc;
        },
        {} as Record<string, PortfolioTokenResponseDto>,
      ),
      wallet: walletPortfolio.wallet,
      protocols: [
        uniswapV3Portfolio,
        aerodromeCLPortfolio,
        aaveV3Portfolio,
        eulerV2Portfolio,
        venusV4Portfolio,
      ].filter((protocol) => protocol !== undefined),
    };
  }

  async getUserWalletPortfolio(
    account: string,
    tokenPrices: TokenPricesResponseDto,
  ): Promise<Pick<PortfolioResponseDto, 'wallet'>> {
    const balanceRets = await this.client.multicall({
      contracts: this.allowedTokens.map((token) => ({
        address: token,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [account],
      })),
    });

    const wallet = balanceRets
      .map((balanceRet, index) => {
        if (balanceRet.status === 'failure') {
          this.logger.error(`got balance failed: ${balanceRet.error}`);
          throw new UnknownException();
        }

        const tokenAddress = this.allowedTokens[index];
        const tokenInfoWithPrice = tokenPrices.tokenPrices.find(
          (token) =>
            token.network === this.network &&
            token.tokenAddress === tokenAddress,
        );
        if (!tokenInfoWithPrice) {
          this.logger.warn(
            `Token info with price not found for token ${tokenAddress}`,
          );
          return null;
        }

        const amount = new Decimal(balanceRet.result).div(
          new Decimal(10).pow(tokenInfoWithPrice.tokenDecimals),
        );

        return {
          tokenAddress,
          amount: amount.toString(),
          amountUsd: amount.mul(tokenInfoWithPrice.bid).toString(),
        };
      })
      .filter((wallet) => wallet !== null);

    return {
      wallet,
    };
  }
}
