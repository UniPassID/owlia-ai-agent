import { Logger } from '@nestjs/common';
import { NetworkDto } from './dto/network.dto';
import { UnknownException } from './exceptions/base.exception';

export class TrackerClient {
  private readonly logger = new Logger(TrackerClient.name);

  constructor(private readonly url: string) {}

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

export type TokenRequestDto = {
  network: NetworkDto;
  tokenAddress: string;
};

export type TokensRequestDto = {
  tokens: TokenRequestDto[];
};

export type TokenPriceResponseDto = {
  network: NetworkDto;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  bid: string;
  ask: string;
  snapshotTimestampMs: string;
};

export type TokenPricesResponseDto = {
  tokenPrices: TokenPriceResponseDto[];
};

export enum DexKeyDto {
  UniswapV3 = 'UniswapV3',
  AerodromeCL = 'AerodromeCL',
}

export type PoolSnapshotsRequestDto = {
  network: NetworkDto;
  dexKey: DexKeyDto;
  poolAddress: string[];
  startId?: string;
  limit?: number;
  fromTimestampMs?: string;
  toTimestampMs?: string;
};

export type PoolSnapshotsResponseDto = {
  snapshots: PoolSnapshotResponseDto[];
};

export type PoolSnapshotResponseDto = {
  id?: string;
  dexKey: DexKeyDto;
  poolAddress: string;
  token0: string;
  token1: string;
  token0Symbol: string;
  token1Symbol: string;
  fee: string;
  currentTick: string;
  currentPrice: string;
  tickSpacing: string;
  startTick: string;
  ticks: PoolSnapshotTickInfoResponseDto[];
  timestampMs: string;
  tvl: string;
};

export type PoolSnapshotTickInfoResponseDto = {
  tick: string;
  token0Amount: string;
  token1Amount: string;
  token0AmountUsd: string;
  token1AmountUsd: string;
  apy: string;
  tradingVolume: string;
};

export type PoolLatestSnapshotResponseDto = {
  snapshots: PoolSnapshotResponseDto[];
  currentSnapshot: PoolSnapshotResponseDto;
};
