import { Logger } from '@nestjs/common';
import { createPublicClient, http, PublicClient } from 'viem';
import { getChain, NetworkDto } from '../../../../common/dto/network.dto';
import { fallback } from '../../../../common/fallback-transport';
import { COMPOUND_V3_COMET_ADDRESS } from '../../../../common/constants';

export class CompoundV3Manager {
  private readonly logger: Logger = new Logger(CompoundV3Manager.name);
  private readonly client: PublicClient;
  public readonly cometAddress: string;

  constructor(
    private readonly network: NetworkDto,
    private readonly rpcUrls: string[],
  ) {
    this.client = createPublicClient({
      chain: getChain(this.network),
      transport: fallback(this.rpcUrls.map((rpcUrl) => http(rpcUrl))),
    });

    this.cometAddress = COMPOUND_V3_COMET_ADDRESS[this.network];
  }
}
