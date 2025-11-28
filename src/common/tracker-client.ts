import { Logger } from '@nestjs/common';
import { NetworkDto } from './dto/network.dto';
import { UnknownException } from './exceptions/base.exception';

export class TrackerClient {
  private readonly logger = new Logger(TrackerClient.name);

  constructor(private readonly url: string) {}

  async safeFetch(url: string, options: RequestInit): Promise<Response> {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      this.logger.error(`Failed to fetch ${url}: ${error}`);
      throw new UnknownException();
    }
  }

  async tokenPrices(tokens: TokensRequestDto): Promise<TokenPricesResponseDto> {
    const response = await this.safeFetch(
      `${this.url}/api/v1/token-price/list`,
      {
        method: 'POST',
        body: JSON.stringify(tokens),
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

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
