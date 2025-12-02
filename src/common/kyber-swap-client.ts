import axios from 'axios';
import { NetworkDto } from './dto/network.dto';

const AggregatorDomain = `https://aggregator-api.kyberswap.com`;

enum ChainName {
  MAINNET = `ethereum`,
  BSC = `bsc`,
  ARBITRUM = `arbitrum`,
  MATIC = `polygon`,
  OPTIMISM = `optimism`,
  AVAX = `avalanche`,
  BASE = `base`,
  CRONOS = `cronos`,
  ZKSYNC = `zksync`,
  FANTOM = `fantom`,
  LINEA = `linea`,
  POLYGONZKEVM = `polygon-zkevm`,
  AURORA = `aurora`,
  BTTC = `bittorrent`,
  SCROLL = `scroll`,
}

export class KyberSwapClient {
  constructor() {}

  getChainName(network: NetworkDto): ChainName {
    switch (network) {
      case NetworkDto.Bsc:
        return ChainName.BSC;
      case NetworkDto.Base:
        return ChainName.BASE;
    }
  }

  async getSwapRouteV1(
    network: NetworkDto,
    tokenIn: string,
    amountIn: bigint,
    tokenOut: string,
  ) {
    const targetChain = this.getChainName(network);
    const targetPath = `/${targetChain}/api/v1/routes`;

    // Specify the call parameters (only the required params are specified here, see Docs for full list)
    const targetPathConfig = {
      params: {
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        amountIn: amountIn.toString(),
      },
    };

    const { data } = await axios.get(
      AggregatorDomain + targetPath,
      targetPathConfig,
    );

    return data.data;
  }

  async postSwapRouteV1(
    account: string,
    network: NetworkDto,
    slippageTolerance: number,
    swapRouteData: any,
  ) {
    // Get the path to be called
    const targetChain = this.getChainName(network);
    const targetPath = `/${targetChain}/api/v1/route/build`;

    const routeSummary = swapRouteData.routeSummary;

    try {
      // Configure the request body (refer to Docs for the full list)
      const requestBody = {
        routeSummary: routeSummary,
        sender: account,
        recipient: account,
        slippageTolerance: slippageTolerance,
      };

      const { data } = await axios.post(
        AggregatorDomain + targetPath,
        requestBody,
      );

      return data.data;
    } catch (error) {
      console.error(
        'Error in postSwapRouteV1:',
        error,
        JSON.stringify(swapRouteData, null, 2),
      );
      throw error;
    }
  }
}
