import { Inject, Injectable, Logger } from '@nestjs/common';
import { NetworkDto } from '../../../common/dto/network.dto';
import { CompoundV3Manager } from './utils/compound-v3-manager';
import blockchainsConfig from '../../../config/blockchains.config';
import { ConfigType } from '@nestjs/config';

@Injectable()
export class CompoundV3Service {
  private readonly compoundV3Managers: Record<
    NetworkDto,
    CompoundV3Manager | undefined
  >;

  private readonly logger = new Logger(CompoundV3Service.name);

  constructor(
    @Inject(blockchainsConfig.KEY)
    blockchains: ConfigType<typeof blockchainsConfig>,
  ) {
    this.compoundV3Managers = {
      [NetworkDto.Base]: this.createCompoundV3Manager(
        NetworkDto.Base,
        blockchains,
      ),
    };
  }

  createCompoundV3Manager(
    network: NetworkDto,
    blockchains: ConfigType<typeof blockchainsConfig>,
  ): CompoundV3Manager | undefined {
    try {
      return new CompoundV3Manager(network, blockchains[network].rpcUrls);
    } catch (error) {
      this.logger.warn(`Failed to create CompoundV3Manager: ${error}`);
      return undefined;
    }
  }

  getCompoundV3CometAddress(network: NetworkDto): string | undefined {
    return this.compoundV3Managers[network]?.cometAddress;
  }
}
