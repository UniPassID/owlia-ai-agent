import { NetworkDto } from '../../../common/dto/network.dto';

export type TokenRequestDto = {
  network: NetworkDto;
  tokenAddress: string;
};

export type TokensRequestDto = {
  tokens: TokenRequestDto[];
};
