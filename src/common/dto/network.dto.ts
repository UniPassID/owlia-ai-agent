import { Chain } from 'viem';
import { bsc, base } from 'viem/chains';

export enum NetworkDto {
  Bsc = 'bsc',
  Base = 'base',
}

export function getNetworkDto(chainId: number): NetworkDto {
  if (chainId === 56) {
    return NetworkDto.Bsc;
  } else if (chainId === 8453) {
    return NetworkDto.Base;
  }
  throw new Error('Invalid chain ID');
}

export function getChainId(network: NetworkDto): number {
  if (network === NetworkDto.Bsc) {
    return 56;
  } else if (network === NetworkDto.Base) {
    return 8453;
  }
  throw new Error('Invalid network');
}

export function getChain(network: NetworkDto): Chain {
  switch (network) {
    case NetworkDto.Bsc:
      return bsc;
    case NetworkDto.Base:
      return base;
  }
}
