import { NetworkDto } from '../../../common/dto/network.dto';

export enum LPProtocolDto {
  UniswapV3 = 'uniswapV3',
  AerodromeSLipstream = 'aerodromeSlipstream',
}

export enum LendingProtocolDto {
  Aave = 'aave',
  Euler = 'euler',
  Venus = 'venus',
  Compound = 'compound',
  Morpho = 'morpho',
  Moonwell = 'moonwell',
}

export class MarketParamsDto {
  loanToken: string;
  collateralToken: string;
  oracle: string;
  irm: string;
  lltv: number;
}

export class RebalancePositionDto {
  network: NetworkDto;
  safeAddress: string;
  operator: string;
  wallet: string;
  currentBalances: {
    token: string;
    amount: string;
  }[];
  currentLendingSupplyPositions: {
    protocol: LendingProtocolDto;
    token: string;
    vToken?: string | null;
    marketParams?: MarketParamsDto | null;
    amount: string;
  }[];
  currentLiquidityPositions: {
    protocol: LPProtocolDto;
    tokenId: string;
    poolAddress: string;
  }[];
  targetLiquidityPositions: {
    protocol: LPProtocolDto;
    targetTickLower: number;
    targetTickUpper: number;
    targetAmount0: string;
    targetAmount1: string;
    poolAddress: string;
  }[];
  targetLendingSupplyPositions: {
    protocol: LendingProtocolDto;
    token: string;
    vToken?: string | null;
    marketParams?: MarketParamsDto | null;
    amount: string;
  }[];
}
