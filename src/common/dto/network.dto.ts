import { Chain } from 'viem';
import { base } from 'viem/chains';

export enum NetworkDto {
  Base = 'base',
}

export function getNetworkDto(chainId: number): NetworkDto {
  if (chainId === 8453) {
    return NetworkDto.Base;
  }
  throw new Error('Invalid chain ID');
}

export function getChainId(network: NetworkDto): number {
  if (network === NetworkDto.Base) {
    return 8453;
  }
  throw new Error('Invalid network');
}

export function getChain(network: NetworkDto): Chain {
  switch (network) {
    case NetworkDto.Base:
      return base;
  }
}
