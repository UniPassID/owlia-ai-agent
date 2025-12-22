import { NetworkDto } from './dto/network.dto';

export const AAVE_V3_POOL_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
};

export const AAVE_V3_DATA_PROVIDER_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A',
};

export const AERODROME_CL_FACTORY_ADDRESS: Record<NetworkDto, string | null> = {
  [NetworkDto.Base]: '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A',
};

export const AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ADDRESS: Record<
  NetworkDto,
  string | undefined
> = {
  [NetworkDto.Base]: '0x827922686190790b37229fd06084350E74485b72',
};

export const AERODROME_CL_IMPLEMENTATION_ADDRESS: Record<
  NetworkDto,
  string | undefined
> = {
  [NetworkDto.Base]: '0xeC8E5342B19977B4eF8892e02D8DAEcfa1315831',
};

export const EULER_V2_ACCOUNT_LENS_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0xe523607fb5c1e9e7092f4e173cbfd1beb32d524a',
};

export const EULER_V2_EVC_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0x5301c7dd20bd945d2013b48ed0dee3a284ca8989',
};

export const EULER_V2_GOVERNED_PERSPECTIVE_ADDRESS: Record<NetworkDto, string> =
  {
    [NetworkDto.Base]: '0xafc8545c49df2c8216305922d9753bf60bf8c14a',
  };

export const EULER_V2_UTILS_LENS_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0xe055fa087e836efacafa257e5f6cf90936c26cb5',
};

export const OKX_SWAP_ROUTER_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0x4409921Ae43a39a11D90F7B7F96cfd0B8093d9fC',
};

export const UNISWAP_V3_FACTORY_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
};

export const UNISWAP_V3_INIT_HASH: Record<NetworkDto, string> = {
  [NetworkDto.Base]:
    '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54',
};

export const UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ADDRESS: Record<
  NetworkDto,
  string
> = {
  [NetworkDto.Base]: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
};

export const VENUS_V4_COMPTROLLER_ADDRESS: Record<
  NetworkDto,
  string | undefined
> = {
  [NetworkDto.Base]: undefined,
};

export const VENUS_V4_LENS_ADDRESS: Record<NetworkDto, string | undefined> = {
  [NetworkDto.Base]: undefined,
};
