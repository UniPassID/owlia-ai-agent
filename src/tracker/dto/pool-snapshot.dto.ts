import { NetworkDto } from '../../common/dto/network.dto';

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
