import { Inject, Injectable, Logger } from '@nestjs/common';
import { AaveV3Manager } from './utils/aave-v3-manager';
import { NetworkDto } from '../common/dto/network.dto';
import blockchainsConfig from '../config/blockchains.config';
import { ConfigType } from '@nestjs/config';
import { AaveV3ProtocolBlockResponseDto } from './dto/aave-v3.response.dto';
import { TokenPricesResponseDto } from '../tracker/dto/token-price.response';

@Injectable()
export class AaveV3Service {
  aaveV3Managers: Record<NetworkDto, AaveV3Manager | undefined>;

  private readonly logger = new Logger(AaveV3Service.name);

  constructor(
    @Inject(blockchainsConfig.KEY)
    blockchains: ConfigType<typeof blockchainsConfig>,
  ) {
    this.aaveV3Managers = {
      [NetworkDto.Bsc]: this.createAaveV3Manager(NetworkDto.Bsc, blockchains),
      [NetworkDto.Base]: this.createAaveV3Manager(NetworkDto.Base, blockchains),
    };
  }

  createAaveV3Manager(
    network: NetworkDto,
    blockchains: ConfigType<typeof blockchainsConfig>,
  ): AaveV3Manager | undefined {
    try {
      return new AaveV3Manager(network, blockchains[network].rpcUrls);
    } catch (error) {
      this.logger.warn(`Failed to create AaveV3Manager: ${error}`);
      return undefined;
    }
  }

  async getUserAaveV3Portfolio(
    network: NetworkDto,
    account: string,
    tokenPrices: TokenPricesResponseDto,
  ): Promise<AaveV3ProtocolBlockResponseDto | undefined> {
    return await this.aaveV3Managers[network]?.getAaveV3AccountPortfolio(
      account,
      tokenPrices,
    );
  }

  getAaveV3PoolAddress(network: NetworkDto): string | undefined {
    return this.aaveV3Managers[network]?.aavePoolAddress;
  }
}
