import { Inject, Injectable, Logger } from '@nestjs/common';
import { NetworkDto } from '../common/dto/network.dto';
import { EulerV2Manager } from './utils/euler-v2-manager';
import blockchainsConfig from '../config/blockchains.config';
import { ConfigType } from '@nestjs/config';
import { TokenPricesResponseDto } from '../tracker/dto/token-price.response';
import { EulerV2ProtocolBlockResponseDto } from './dto/euler-v2.response.dto';

@Injectable()
export class EulerV2Service {
  eulerV2Managers: Record<NetworkDto, EulerV2Manager | undefined>;

  private readonly logger = new Logger(EulerV2Service.name);

  constructor(
    @Inject(blockchainsConfig.KEY)
    blockchains: ConfigType<typeof blockchainsConfig>,
  ) {
    this.eulerV2Managers = {
      [NetworkDto.Bsc]: this.createEulerV2Manager(NetworkDto.Bsc, blockchains),
      [NetworkDto.Base]: this.createEulerV2Manager(
        NetworkDto.Base,
        blockchains,
      ),
    };
  }

  createEulerV2Manager(
    network: NetworkDto,
    blockchains: ConfigType<typeof blockchainsConfig>,
  ): EulerV2Manager | undefined {
    try {
      return new EulerV2Manager(network, blockchains[network].rpcUrls);
    } catch (error) {
      this.logger.warn(`Failed to create EulerV2Manager: ${error}`);
      return undefined;
    }
  }

  async getUserEulerV2Portfolio(
    network: NetworkDto,
    account: string,
    tokenPrices: TokenPricesResponseDto,
  ): Promise<EulerV2ProtocolBlockResponseDto | undefined> {
    return await this.eulerV2Managers[network]?.getEulerAccountPortfolio(
      account,
      tokenPrices,
    );
  }

  getEulerV2EVCAddress(network: NetworkDto): string | undefined {
    return this.eulerV2Managers[network]?.evAddress;
  }
}
