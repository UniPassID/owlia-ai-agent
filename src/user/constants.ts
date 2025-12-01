import { NetworkDto } from '../common/dto/network.dto';

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
      '0x7b8A01B39D58278b5DE7e48c8449c9f4F5170613',
    aaveV3Pool: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
    kyberSwapRouter: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
    eulerV2EVC: '0xb2E5a73CeE08593d1a076a2AE7A6e02925a640ea',
    venusV4Comptroller: '0xe4C455cBf870A86399043B8A36A669FfA1583e95',
  },
  [NetworkDto.Base]: {
    uniswapV3NonFungiblePositionManager:
      '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
    aerodromeCLNonFungiblePositionManager:
      '0x827922686190790b37229fd06084350E74485b72',
    aaveV3Pool: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
    kyberSwapRouter: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
    eulerV2EVC: '0x5301c7dD20bD945D2013b48ed0DEE3A284ca8989',
  },
};

export const OWLIA_ACCOUNT_SUBGRAPH_URL: Record<NetworkDto, string> = {
  [NetworkDto.Bsc]:
    'https://gateway.thegraph.com/api/subgraphs/id/CfR3HV42wdxJAziDrrLpR3NAfKCipKiJNRZBpmRwCGpm',
  [NetworkDto.Base]:
    'https://gateway.thegraph.com/api/subgraphs/id/FiPXezS3b4DSj88UJgTrQssoek8fuSHqJwo6HoKt8NTM',
};
