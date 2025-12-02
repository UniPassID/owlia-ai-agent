import { Inject, Injectable, Logger } from '@nestjs/common';
import { NetworkDto } from '../common/dto/network.dto';
import { UniswapV3Manager } from './utils/uniswap-v3-manager';
import blockchainsConfig from '../config/blockchains.config';
import { ConfigType } from '@nestjs/config';
import { TrackerService } from '../tracker/tracker.service';
import { TokenPricesResponseDto } from '../tracker/dto/token-price.response';
import {
  UniswapV3LiquidityPositionResponseDto,
  UniswapV3PoolInfoResponseDto,
  UniswapV3ProtocolBlockResponseDto,
} from './dto/uniswap-v3.response.dto';

@Injectable()
export class UniswapV3Service {
  uniswapV3Managers: Record<NetworkDto, UniswapV3Manager | undefined>;

  private readonly logger = new Logger(UniswapV3Service.name);

  constructor(
    @Inject(blockchainsConfig.KEY)
    blockchains: ConfigType<typeof blockchainsConfig>,
    private readonly trackerService: TrackerService,
  ) {
    this.uniswapV3Managers = {
      [NetworkDto.Bsc]: this.createUniswapV3Manager(
        NetworkDto.Bsc,
        blockchains,
      ),
      [NetworkDto.Base]: this.createUniswapV3Manager(
        NetworkDto.Base,
        blockchains,
      ),
    };
  }

  createUniswapV3Manager(
    network: NetworkDto,
    blockchains: ConfigType<typeof blockchainsConfig>,
  ): UniswapV3Manager | undefined {
    try {
      return new UniswapV3Manager(
        network,
        blockchains[network].rpcUrls,
        this.trackerService,
      );
    } catch (error) {
      this.logger.warn(`Failed to create UniswapV3Manager: ${error}`);
      return undefined;
    }
  }

  async getUserUniswapV3Portfolio(
    network: NetworkDto,
    account: string,
    tokenPrices: TokenPricesResponseDto,
  ): Promise<UniswapV3ProtocolBlockResponseDto | undefined> {
    return await this.uniswapV3Managers[network]?.getUserUniswapV3Portfolio(
      account,
      tokenPrices,
    );
  }

  getUniswapV3NonFungiblePositionManagerAddress(
    network: NetworkDto,
  ): string | undefined {
    return this.uniswapV3Managers[network]?.nonfungiblePositionManagerAddress;
  }

  async getLiquidityPosition(
    network: NetworkDto,
    tokenId: bigint,
  ): Promise<UniswapV3LiquidityPositionResponseDto | undefined> {
    return await this.uniswapV3Managers[network]?.getLiquidityPosition(tokenId);
  }

  async getPoolInfo(
    network: NetworkDto,
    poolAddress: string,
  ): Promise<UniswapV3PoolInfoResponseDto | undefined> {
    return await this.uniswapV3Managers[network]?.getPoolInfo(poolAddress);
  }
}
