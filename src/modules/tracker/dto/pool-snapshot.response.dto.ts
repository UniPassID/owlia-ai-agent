import { DexKeyDto } from './pool-snapshot.dto';

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
