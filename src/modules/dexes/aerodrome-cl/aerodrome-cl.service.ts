import { Inject, Injectable, Logger } from '@nestjs/common';
import { NetworkDto } from '../../../common/dto/network.dto';
import { AerodromeCLManager } from './utils/aerodrome-cl-manager';
import blockchainsConfig from '../../../config/blockchains.config';
import { ConfigType } from '@nestjs/config';
import { TrackerService } from '../../tracker/tracker.service';
import { TokenPricesResponseDto } from '../../tracker/dto/token-price.response';
import {
  AerodromeCLLiquidityPositionResponseDto,
  AerodromeCLPoolInfoResponseDto,
  AerodromeCLProtocolBlockResponseDto,
} from './dto/aerodrome-cl.response.dto';

@Injectable()
export class AerodromeClService {
  aerodromeClManagers: Record<NetworkDto, AerodromeCLManager | undefined>;
  private readonly logger = new Logger(AerodromeClService.name);

  constructor(
    private readonly trackerService: TrackerService,
    @Inject(blockchainsConfig.KEY)
    blockchains: ConfigType<typeof blockchainsConfig>,
  ) {
    this.aerodromeClManagers = {
      [NetworkDto.Base]: this.createAerodromeCLManager(
        NetworkDto.Base,
        blockchains,
      ),
    };
  }

  createAerodromeCLManager(
    network: NetworkDto,
    blockchains: ConfigType<typeof blockchainsConfig>,
  ): AerodromeCLManager | undefined {
    try {
      return new AerodromeCLManager(
        network,
        blockchains[network].rpcUrls,
        this.trackerService,
      );
    } catch (error) {
      this.logger.warn(`Failed to create AerodromeCLManager: ${error}`);
      return undefined;
    }
  }

  async getUserAerodromeCLPortfolio(
    network: NetworkDto,
    account: string,
    tokenPrices: TokenPricesResponseDto,
  ): Promise<AerodromeCLProtocolBlockResponseDto | undefined> {
    return await this.aerodromeClManagers[
      network
    ]?.getAerodromeCLAccountPortfolio(account, tokenPrices);
  }

  getAerodromeCLNonFungiblePositionManagerAddress(
    network: NetworkDto,
  ): string | undefined {
    return this.aerodromeClManagers[network]?.nonfungiblePositionManagerAddress;
  }

  async getLiquidityPosition(
    network: NetworkDto,
    tokenId: bigint,
  ): Promise<AerodromeCLLiquidityPositionResponseDto | undefined> {
    return await this.aerodromeClManagers[network]?.getLiquidityPosition(
      tokenId,
    );
  }

  async getPoolInfo(
    network: NetworkDto,
    poolAddress: string,
  ): Promise<AerodromeCLPoolInfoResponseDto | undefined> {
    return await this.aerodromeClManagers[network]?.getPoolInfo(poolAddress);
  }
}
