import { createPublicClient, http, PublicClient } from 'viem';
import { getChain, NetworkDto } from '../../../../common/dto/network.dto';
import { Logger } from '@nestjs/common';
import { fallback } from '../../../../common/fallback-transport';

export class MorphoManager {
  public readonly morphoAddress: string;

  private readonly client: PublicClient;
  private readonly logger: Logger = new Logger(MorphoManager.name);

  constructor(
    private readonly network: NetworkDto,
    private readonly rpcUrls: string[],
  ) {
    this.client = createPublicClient({
      chain: getChain(this.network),
      transport: fallback(this.rpcUrls.map((rpcUrl) => http(rpcUrl))),
    });
  }
}
