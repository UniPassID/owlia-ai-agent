import { Inject, Injectable, Logger } from '@nestjs/common';
import { NetworkDto } from '../../../common/dto/network.dto';
import { VenusV4Manager } from './utils/venus-v4-manager';
import blockchainsConfig from '../../../config/blockchains.config';
import { ConfigType } from '@nestjs/config';
import { VenusV4ProtocolBlockResponseDto } from './dto/venus-v4.response.dto';
import { TokenPricesResponseDto } from '../../tracker/dto/token-price.response';

@Injectable()
export class VenusV4Service {
  venusV4Managers: Record<NetworkDto, VenusV4Manager | undefined>;

  private readonly logger = new Logger(VenusV4Service.name);

  constructor(
    @Inject(blockchainsConfig.KEY)
    blockchains: ConfigType<typeof blockchainsConfig>,
  ) {
    this.venusV4Managers = {
      [NetworkDto.Base]: this.createVenusV4Manager(
        NetworkDto.Base,
        blockchains,
      ),
    };
  }

  createVenusV4Manager(
    network: NetworkDto,
    blockchains: ConfigType<typeof blockchainsConfig>,
  ): VenusV4Manager | undefined {
    try {
      return new VenusV4Manager(network, blockchains[network].rpcUrls);
    } catch (error) {
      this.logger.warn(`Failed to create VenusV4Manager: ${error}`);
      return undefined;
    }
  }

  async getUserVenusV4Portfolio(
    network: NetworkDto,
    account: string,
    tokenPrices: TokenPricesResponseDto,
  ): Promise<VenusV4ProtocolBlockResponseDto | undefined> {
    return await this.venusV4Managers[network]?.getVenusV4AccountPortfolio(
      account,
      tokenPrices,
    );
  }

  getVenusV4ComptrollerAddress(network: NetworkDto): string | undefined {
    return this.venusV4Managers[network]?.comptrollerAddress;
  }
}
