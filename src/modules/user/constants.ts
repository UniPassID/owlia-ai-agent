import { NetworkDto } from '../../common/dto/network.dto';

export const OWLIA_ACCOUNT_SUBGRAPH_URL: Record<NetworkDto, string> = {
  [NetworkDto.Base]:
    'https://gateway.thegraph.com/api/subgraphs/id/FiPXezS3b4DSj88UJgTrQssoek8fuSHqJwo6HoKt8NTM',
};

export type TokenInfo = {
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
};

export const DEFAULT_TOKENS: Record<NetworkDto, TokenInfo[]> = {
  [NetworkDto.Base]: [
    {
      tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      tokenSymbol: 'USDC',
      tokenDecimals: 6,
    },
  ],
};
