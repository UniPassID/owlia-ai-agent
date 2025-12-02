import { NetworkDto } from '../../../common/dto/network.dto';

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
