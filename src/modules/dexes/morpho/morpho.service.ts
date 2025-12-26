import { Inject, Injectable, Logger } from '@nestjs/common';
import { MorphoManager } from './utils/morpho-manager';
import { NetworkDto } from '../../../common/dto/network.dto';
import { ConfigType } from '@nestjs/config';
import blockchainsConfig from '../../../config/blockchains.config';

@Injectable()
export class MorphoService {
  private readonly logger = new Logger(MorphoService.name);
  private readonly morphoManagers: Record<
    NetworkDto,
    MorphoManager | undefined
  >;

  constructor(
    @Inject(blockchainsConfig.KEY)
    blockchains: ConfigType<typeof blockchainsConfig>,
  ) {
    this.morphoManagers = {
      [NetworkDto.Base]: this.createMorphoManager(NetworkDto.Base, blockchains),
    };
  }

  createMorphoManager(
    network: NetworkDto,
    blockchains: ConfigType<typeof blockchainsConfig>,
  ): MorphoManager | undefined {
    try {
      return new MorphoManager(network, blockchains[network].rpcUrls);
    } catch (error) {
      this.logger.warn(`Failed to create MorphoManager: ${error}`);
      return undefined;
    }
  }

  getMorphoAddress(network: NetworkDto): string | undefined {
    return this.morphoManagers[network]?.morphoAddress;
  }
}
