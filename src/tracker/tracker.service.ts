import { Inject, Injectable, Logger } from '@nestjs/common';
import { TokensRequestDto } from './dto/token-price.dto';
import { TokenPricesResponseDto } from './dto/token-price.response';
import { UnknownException } from '../common/exceptions/base.exception';
import { NetworkDto } from '../common/dto/network.dto';
import { DexKeyDto } from './dto/pool-snapshot.dto';
import { PoolLatestSnapshotResponseDto } from './dto/pool-snapshot.response.dto';
import trackerConfig from '../config/tracker.config';
import { ConfigType } from '@nestjs/config';

@Injectable()
export class TrackerService {
  private readonly logger = new Logger(TrackerService.name);

  private readonly url: string;

  constructor(
    @Inject(trackerConfig.KEY)
    private readonly config: ConfigType<typeof trackerConfig>,
  ) {
    this.url = this.config.url;
  }

  async tokenPrices(tokens: TokensRequestDto): Promise<TokenPricesResponseDto> {
    const response = await fetch(`${this.url}/api/v1/token-price/list`, {
      method: 'POST',
      body: JSON.stringify(tokens),
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      this.logger.error(`Failed to get token prices: ${response.statusText}`);
      throw new UnknownException();
    }

    const data = await response.json();
    if (data.code !== 0) {
      this.logger.error(`Failed to get token prices: ${data.message}`);
      throw new UnknownException();
    }
    return data.data;
  }

  async getPoolSnapshotCaches(
    network: NetworkDto,
    dexKey: DexKeyDto,
    poolAddress: string,
  ): Promise<PoolLatestSnapshotResponseDto> {
    const response = await fetch(
      `${this.url}/api/v1/dex-pool/snapshot-caches/${network}/${dexKey}/${poolAddress}`,
      {
        method: 'GET',
      },
    );

    if (!response.ok) {
      this.logger.error(`Failed to get pool snapshots: ${response.statusText}`);
      throw new UnknownException();
    }

    const data = await response.json();
    if (data.code !== 0) {
      this.logger.error(`Failed to get pool snapshots: ${data.message}`);
      throw new UnknownException();
    }
    return data.data;
  }
}
