import {
  AAVE_V3_POOL_ADDRESS,
  EULER_V2_EVC_ADDRESS,
  OKX_SWAP_ROUTER_ADDRESS,
} from '../../common/constants';
import { NetworkDto } from '../../common/dto/network.dto';
import {
  DeploymentConfigResponseDto,
  ValidatorProtocolDto,
  ValidatorTypeDto,
} from './dto/deployment.response.dto';

export const SALT_NONCE =
  '0x47d3c7c3f44f7e04d88199ea908538d4c5c19fcc1826b351111da656bc5f2ead';

export const OWLIA_GUARD_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0xc1fFf87CB08714C56A35c8537e54FE095bA6abB2',
};

export const OWLIA_OPERATOR_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0x63ba53C38491f387211FF31748E442380Ef04a7C',
};

export const OWLIA_VALIDATOR_AAVE_V3_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0x4D3CB1E122a513939728f4d09AceD5B43BaCe793',
};

export const OWLIA_VALIDATOR_EULER_V2_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0x715472Ff182B21fD8517A4827CEdC6c4AF9Bd5e6',
};

export const OWLIA_VALIDATOR_OKX_SWAP_ADDRESS: Record<NetworkDto, string> = {
  [NetworkDto.Base]: '0x1D19A5C657B69921e5856824549Fd83a3c77Cdec',
};

export const DEFAULT_DEPLOYMENT_CONFIGS: Record<
  NetworkDto,
  DeploymentConfigResponseDto
> = {
  [NetworkDto.Base]: {
    network: NetworkDto.Base,
    saltNonce: SALT_NONCE,
    operator: OWLIA_OPERATOR_ADDRESS[NetworkDto.Base],
    guard: OWLIA_GUARD_ADDRESS[NetworkDto.Base],
    validators: [
      {
        type: ValidatorTypeDto.Lending,
        protocol: ValidatorProtocolDto.AaveV3,
        validator: OWLIA_VALIDATOR_AAVE_V3_ADDRESS[NetworkDto.Base],
        targets: [AAVE_V3_POOL_ADDRESS[NetworkDto.Base]],
        markets: [{ contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }],
      },
      {
        type: ValidatorTypeDto.Lending,
        protocol: ValidatorProtocolDto.EulerV2,
        validator: OWLIA_VALIDATOR_EULER_V2_ADDRESS[NetworkDto.Base],
        targets: [EULER_V2_EVC_ADDRESS[NetworkDto.Base]],
        markets: [
          {
            contract: '0x0A1a3b5f2041F33522C4efc754a7D096f880eE16',
          },
          {
            contract: '0xC063C3b3625DF5F362F60f35B0bcd98e0fa650fb',
          },
        ],
      },
      {
        type: ValidatorTypeDto.Swap,
        protocol: ValidatorProtocolDto.OkxSwap,
        validator: OWLIA_VALIDATOR_OKX_SWAP_ADDRESS[NetworkDto.Base],
        targets: [OKX_SWAP_ROUTER_ADDRESS[NetworkDto.Base]],
        assets: [
          {
            contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            name: 'USDC',
            symbol: 'USDC',
          },
        ],
      },
    ],
  },
};
