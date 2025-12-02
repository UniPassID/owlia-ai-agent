import { Logger } from '@nestjs/common';
import {
  getChain,
  getChainId,
  NetworkDto,
} from '../../../common/dto/network.dto';
import {
  createPublicClient,
  http,
  padBytes,
  PublicClient,
  toBytes,
} from 'viem';
import { fallback } from '../../../common/fallback-transport';
import { ERC20_ABI } from '../../../abis/erc-20.abi';
import { UnknownException } from '../../../common/exceptions/base.exception';
import Decimal from 'decimal.js';
import {
  PortfolioResponseDto,
  PortfolioTokenResponseDto,
} from '../dto/user-portfolio.response.dto';
import { DEFAULT_TOKENS, OWLIA_ACCOUNT_SUBGRAPH_URL } from '../constants';
import request, { gql } from 'graphql-request';
import { TokenPricesResponseDto } from '../../tracker/dto/token-price.response';
import { TrackerService } from '../../tracker/tracker.service';
import { UniswapV3Service } from '../../dexes/uniswap-v3/uniswap-v3.service';
import { AerodromeClService } from '../../dexes/aerodrome-cl/aerodrome-cl.service';
import { AaveV3Service } from '../../dexes/aave-v3/aave-v3.service';
import { EulerV2Service } from '../../dexes/euler-v2/euler-v2.service';
import { VenusV4Service } from '../../dexes/venus-v4/venus-v4.service';

export class UserChainManager {
  allowedTokens: string[];
  subgraphUrl: string;

  private readonly logger: Logger = new Logger(UserChainManager.name);
  private readonly client: PublicClient;

  constructor(
    private readonly network: NetworkDto,
    private readonly rpcUrls: string[],
    private readonly trackerService: TrackerService,
    private readonly uniswapV3Service: UniswapV3Service,
    private readonly aerodromeCLService: AerodromeClService,
    private readonly aaveV3Service: AaveV3Service,
    private readonly eulerV2Service: EulerV2Service,
    private readonly venusV4Service: VenusV4Service,
  ) {
    this.allowedTokens = DEFAULT_TOKENS[network];

    this.client = createPublicClient({
      chain: getChain(this.network),
      transport: fallback(this.rpcUrls.map((rpcUrl) => http(rpcUrl))),
    });

    this.subgraphUrl = OWLIA_ACCOUNT_SUBGRAPH_URL[this.network];
  }

  async getUserNetDeposit(
    account: string,
    isDeployed: boolean,
  ): Promise<string | null> {
    if (!isDeployed) {
      return null;
    }

    const id = padBytes(toBytes(account as `0x${string}`), {
      size: 32,
      dir: 'left',
    });

    const query = gql`
      {
        owliaAccounts(where: { id: "${id}" }, orderBy: sortKey, orderDirection: asc) {
          netDeposit
        }
      }
    `;

    const response = await request(this.subgraphUrl, query);
    return response.owliaAccounts[0].netDeposit;
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

  async getUserPortfolio(
    account: string,
    isDeployed: boolean,
  ): Promise<PortfolioResponseDto> {
    const tokenPrices = await this.trackerService.tokenPrices({
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
      netDepositUsdResponse,
    ] = await Promise.all([
      this.uniswapV3Service.getUserUniswapV3Portfolio(
        this.network,
        account,
        tokenPrices,
      ),
      this.aerodromeCLService.getUserAerodromeCLPortfolio(
        this.network,
        account,
        tokenPrices,
      ),
      this.aaveV3Service.getUserAaveV3Portfolio(
        this.network,
        account,
        tokenPrices,
      ),
      this.eulerV2Service.getUserEulerV2Portfolio(
        this.network,
        account,
        tokenPrices,
      ),
      this.venusV4Service.getUserVenusV4Portfolio(
        this.network,
        account,
        tokenPrices,
      ),
      this.getUserWalletPortfolio(account, tokenPrices),
      this.getUserNetDeposit(account, isDeployed),
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

    const netDepositUsd =
      netDepositUsdResponse === null
        ? netUsd
        : new Decimal(netDepositUsdResponse);

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
        netDepositUsd: netDepositUsd.toString(),
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
}
