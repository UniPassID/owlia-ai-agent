import { NetworkDto } from './dto/network.dto';

export const AAVE_V3_POOL_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Bsc]: '0x6807dc923806fE8Fd134338EABCA509979a7e0cB',
  [NetworkDto.Base]: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
};

export const AAVE_V3_DATA_PROVIDER_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Bsc]: '0x1e26247502e90b4fab9D0d17e4775e90085D2A35',
  [NetworkDto.Base]: '0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A',
};

export const AERODROME_CL_FACTORY_ADDRESS: Record<NetworkDto, string | null> = {
  [NetworkDto.Bsc]: null,
  [NetworkDto.Base]: '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A',
};

export const AERODROME_CL_NONFUNGIBLE_POSITION_MANAGER_ADDRESS: Record<
  NetworkDto,
  string | undefined
> = {
  [NetworkDto.Bsc]: undefined,
  [NetworkDto.Base]: '0x827922686190790b37229fd06084350E74485b72',
};

export const AERODROME_CL_IMPLEMENTATION_ADDRESS: Record<
  NetworkDto,
  string | undefined
> = {
  [NetworkDto.Bsc]: undefined,
  [NetworkDto.Base]: '0xeC8E5342B19977B4eF8892e02D8DAEcfa1315831',
};

export const EULER_V2_ACCOUNT_LENS_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Bsc]: '0x505f3214df11f3e7c7351e7c262e2ba1459fea60',
  [NetworkDto.Base]: '0xe523607fb5c1e9e7092f4e173cbfd1beb32d524a',
};

export const EULER_V2_EVC_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Bsc]: '0xb2e5a73cee08593d1a076a2ae7a6e02925a640ea',
  [NetworkDto.Base]: '0x5301c7dd20bd945d2013b48ed0dee3a284ca8989',
};

export const EULER_V2_GOVERNED_PERSPECTIVE_ADDRESS: Record<NetworkDto, string> =
  {
    [NetworkDto.Bsc]: '0x775231e5da4f548555eee633ebf7355a83a0fc03',
    [NetworkDto.Base]: '0xafc8545c49df2c8216305922d9753bf60bf8c14a',
  };

export const EULER_V2_UTILS_LENS_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Bsc]: '0x30be272d1441e9935bcbea2cd924cd5e568a052e',
  [NetworkDto.Base]: '0xe055fa087e836efacafa257e5f6cf90936c26cb5',
};

export const UNISWAP_V3_FACTORY_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Bsc]: '0xdb1d10011ad0ff90774d0c6bb92e5c5c8b4461f7',
  [NetworkDto.Base]: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
};

export const UNISWAP_V3_INIT_HASH: Record<NetworkDto, string> = {
  [NetworkDto.Bsc]:
    '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54',
  [NetworkDto.Base]:
    '0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54',
};

export const UNISWAP_V3_NONFUNGIBLE_POSITION_MANAGER_ADDRESS: Record<
  NetworkDto,
  string
> = {
  [NetworkDto.Bsc]: '0x7b8a01b39d58278b5de7e48c8449c9f4f5170613',
  [NetworkDto.Base]: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
};

export const VENUS_V4_COMPTROLLER_ADDRESS: Record<
  NetworkDto,
  string | undefined
> = {
  [NetworkDto.Bsc]: '0xfd36e2c2a6789db23113685031d7f16329158384',
  [NetworkDto.Base]: undefined,
};

export const VENUS_V4_LENS_ADDRESS: Record<NetworkDto, string | undefined> = {
  [NetworkDto.Bsc]: '0xe4c455cbf870a86399043b8a36a669ffa1583e95',
  [NetworkDto.Base]: undefined,
};
