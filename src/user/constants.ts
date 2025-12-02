import { NetworkDto } from '../common/dto/network.dto';
import {
  AAVE_V3_POOL_ADDRESS,
  AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ADDRESS,
  EULER_V2_EVC_ADDRESS,
  UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ADDRESS,
  VENUS_V4_COMPTROLLER_ADDRESS,
} from '../common/constants';

export type ValidatorConfig = {
  uniswapV3NonFungiblePositionManager: string;
  aerodromeCLNonFungiblePositionManager?: string;
  aaveV3Pool: string;
  kyberSwapRouter: string;
  eulerV2EVC: string;
  venusV4Comptroller?: string;
};

export const VALIDATOR_CONFIGS: Record<NetworkDto, ValidatorConfig> = {
  [NetworkDto.Bsc]: {
    uniswapV3NonFungiblePositionManager:
      UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ADDRESS[NetworkDto.Bsc],
    aerodromeCLNonFungiblePositionManager:
      AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ADDRESS[NetworkDto.Bsc],
    aaveV3Pool: AAVE_V3_POOL_ADDRESS[NetworkDto.Bsc],
    kyberSwapRouter: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
    eulerV2EVC: EULER_V2_EVC_ADDRESS[NetworkDto.Bsc],
    venusV4Comptroller: VENUS_V4_COMPTROLLER_ADDRESS[NetworkDto.Bsc],
  },
  [NetworkDto.Base]: {
    uniswapV3NonFungiblePositionManager:
      UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ADDRESS[NetworkDto.Base],
    aerodromeCLNonFungiblePositionManager:
      AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ADDRESS[NetworkDto.Base],
    aaveV3Pool: AAVE_V3_POOL_ADDRESS[NetworkDto.Base],
    kyberSwapRouter: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
    eulerV2EVC: EULER_V2_EVC_ADDRESS[NetworkDto.Base],
  },
};

export const OWLIA_ACCOUNT_SUBGRAPH_URL: Record<NetworkDto, string> = {
  [NetworkDto.Bsc]:
    'https://gateway.thegraph.com/api/subgraphs/id/CfR3HV42wdxJAziDrrLpR3NAfKCipKiJNRZBpmRwCGpm',
  [NetworkDto.Base]:
    'https://gateway.thegraph.com/api/subgraphs/id/FiPXezS3b4DSj88UJgTrQssoek8fuSHqJwo6HoKt8NTM',
};

export const DEFAULT_TOKENS: Record<NetworkDto, string[]> = {
  [NetworkDto.Bsc]: [
    '0x55d398326f99059fF775485246999027B3197955',
    '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  ],
  [NetworkDto.Base]: [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
  ],
};
