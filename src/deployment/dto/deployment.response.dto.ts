import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { NetworkDto } from '../../user/dto/common.dto';

export enum ValidatorTypeDto {
  UniswapV3 = 'uniswap-v3',
  AerodromeCL = 'aerodrome-cl',
  AaveV3 = 'aave-v3',
  EulerV2 = 'euler-v2',
  VenusV4 = 'venus-v4',
  KyberSwap = 'kyber-swap',
}

export class ValidatorUniswapV3PoolResponseDto {
  @ApiProperty({
    description: 'The address of the pool',
    example: '0x1234567890abcdef',
  })
  address: string;

  @ApiProperty({
    description: 'The token0 of the pool',
    example: '0x1234567890abcdef',
  })
  token0: string;
  @ApiProperty({
    description: 'The token1 of the pool',
    example: '0x1234567890abcdef',
  })
  token1: string;

  @ApiProperty({
    description: 'The fee of the pool',
    example: 100,
  })
  fee: number;

  @ApiProperty({
    description: 'The tick lower of the pool',
    example: -10,
  })
  tickLower: number;

  @ApiProperty({
    description: 'The tick upper of the pool',
    example: 10,
  })
  tickUpper: number;
}

export class ValidatorUniswapV3ResponseDto {
  @ApiProperty({
    description: 'The type of the protocol',
    example: 'uniswap-v3',
  })
  type: ValidatorTypeDto.UniswapV3;

  @ApiProperty({
    description: 'The validator of the protocol',
    example: '0x1234567890abcdef',
  })
  validator: string;

  @ApiProperty({
    description: 'The pools of the protocol',
    type: [ValidatorUniswapV3PoolResponseDto],
  })
  pools: ValidatorUniswapV3PoolResponseDto[];
}

export class ValidatorAerodromeCLPoolResponseDto {
  @ApiProperty({
    description: 'The address of the pool',
    example: '0x1234567890abcdef',
  })
  address: string;
  @ApiProperty({
    description: 'The token0 of the pool',
    example: '0x1234567890abcdef',
  })
  token0: string;
  @ApiProperty({
    description: 'The token1 of the pool',
    example: '0x1234567890abcdef',
  })
  token1: string;

  @ApiProperty({
    description: 'The tick spacing of the pool',
    example: 1,
  })
  tickSpacing: number;

  @ApiProperty({
    description: 'The tick lower of the pool',
    example: -10,
  })
  tickLower: number;

  @ApiProperty({
    description: 'The tick upper of the pool',
    example: 10,
  })
  tickUpper: number;
}

export class ValidatorAerodromeCLResponseDto {
  @ApiProperty({
    description: 'The type of the protocol',
    example: 'aerodrome-cl',
  })
  type: ValidatorTypeDto.AerodromeCL;

  @ApiProperty({
    description: 'The validator of the protocol',
    example: '0x1234567890abcdef',
  })
  validator: string;

  @ApiProperty({
    description: 'The pools of the protocol',
    type: [ValidatorAerodromeCLPoolResponseDto],
  })
  pools: ValidatorAerodromeCLPoolResponseDto[];
}

export class ValidatorAaveV3ResponseDto {
  @ApiProperty({
    description: 'The type of the protocol',
    example: 'aave-v3',
  })
  type: ValidatorTypeDto.AaveV3;

  @ApiProperty({
    description: 'The validator of the protocol',
    example: '0x1234567890abcdef',
  })
  validator: string;

  @ApiProperty({
    description: 'The assets of the protocol',
    type: [String],
  })
  assets: string[];
}

export class ValidatorEulerV2ResponseDto {
  @ApiProperty({
    description: 'The type of the protocol',
    example: 'euler-v2',
  })
  type: ValidatorTypeDto.EulerV2;

  @ApiProperty({
    description: 'The validator of the protocol',
    example: '0x1234567890abcdef',
  })
  validator: string;

  @ApiProperty({
    description: 'The vaults of the protocol',
    type: [String],
  })
  vaults: string[];
}

export class ValidatorVenusV4ResponseDto {
  @ApiProperty({
    description: 'The type of the protocol',
    example: 'venus-v4',
  })
  type: ValidatorTypeDto.VenusV4;

  @ApiProperty({
    description: 'The validator of the protocol',
    example: '0x1234567890abcdef',
  })
  validator: string;

  @ApiProperty({
    description: 'The vaults of the protocol',
    type: [String],
  })
  vaults: string[];
}

export class ValidatorKyberSwapResponseDto {
  @ApiProperty({
    description: 'The type of the protocol',
    example: 'kyber-swap',
  })
  type: ValidatorTypeDto.KyberSwap;

  @ApiProperty({
    description: 'The validator of the protocol',
    example: '0x1234567890abcdef',
  })
  validator: string;

  @ApiProperty({
    description: 'The tokens',
    type: [String],
  })
  tokens: string[];
}

export type ValidatorResponseDto =
  | ValidatorUniswapV3ResponseDto
  | ValidatorAerodromeCLResponseDto
  | ValidatorAaveV3ResponseDto
  | ValidatorEulerV2ResponseDto
  | ValidatorVenusV4ResponseDto
  | ValidatorKyberSwapResponseDto;

@ApiExtraModels(
  ValidatorUniswapV3ResponseDto,
  ValidatorAerodromeCLResponseDto,
  ValidatorAaveV3ResponseDto,
  ValidatorEulerV2ResponseDto,
  ValidatorVenusV4ResponseDto,
  ValidatorKyberSwapResponseDto,
)
export class DeploymentConfigResponseDto {
  @ApiProperty({
    description: 'The salt nonce of the deployment config',
    example:
      '0x47d3c7c3f44f7e04d88199ea908538d4c5c19fcc1826b351111da656bc5f2ead',
  })
  saltNonce: string;

  @ApiProperty({
    description: 'The operator of the deployment config',
    example: '0x1234567890abcdef',
  })
  operator: string;

  @ApiProperty({
    description: 'The guard of the deployment config',
    example: '0x1234567890abcdef',
  })
  guard: string;

  @ApiProperty({
    description: 'The validators',
    oneOf: [
      { $ref: getSchemaPath(ValidatorUniswapV3ResponseDto) },
      { $ref: getSchemaPath(ValidatorAerodromeCLResponseDto) },
      { $ref: getSchemaPath(ValidatorAaveV3ResponseDto) },
      { $ref: getSchemaPath(ValidatorEulerV2ResponseDto) },
      { $ref: getSchemaPath(ValidatorVenusV4ResponseDto) },
      { $ref: getSchemaPath(ValidatorKyberSwapResponseDto) },
    ],
  })
  validators: ValidatorResponseDto[];
}

export const SALT_NONCE =
  '0x47d3c7c3f44f7e04d88199ea908538d4c5c19fcc1826b351111da656bc5f2ead';

export const DEFAULT_DEPLOYMENT_CONFIGS: Record<
  NetworkDto,
  DeploymentConfigResponseDto
> = {
  [NetworkDto.Bsc]: {
    saltNonce: SALT_NONCE,
    operator: '0x3E04BAFC29D2A6E7d1127cb2627beA34D3343B90',
    guard: '0xd3e648D925D56E7F49620C14A08172835749aB77',
    validators: [
      {
        type: ValidatorTypeDto.UniswapV3,
        validator: '0xd99055FE656F7ff03b7e331d898EF522D069d2F0',
        pools: [
          {
            address: '0xfDFc89d953e044f84faa2Ed4953190A066328ee0',
            token0: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
            token1: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
            fee: 100,
            tickLower: -10,
            tickUpper: 10,
          },
          {
            address: '0xF150d29d92E7460a1531cbc9D1AbeAB33D6998e4',
            token0: '0x55d398326f99059fF775485246999027B3197955',
            token1: '0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d',
            fee: 100,
            tickLower: -10,
            tickUpper: 10,
          },
          {
            address: '0x2C3c320D49019D4f9A92352e947c7e5AcFE47D68',
            token0: '0x55d398326f99059fF775485246999027B3197955',
            token1: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
            fee: 100,
            tickLower: -10,
            tickUpper: 10,
          },
        ],
      },
      {
        type: ValidatorTypeDto.AaveV3,
        validator: '0xdccEBb8BC784EdbBf38b0f4da3EC89d262CDC5F4',
        assets: [
          '0x55d398326f99059ff775485246999027b3197955',
          '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
          '0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d',
        ],
      },
      {
        type: ValidatorTypeDto.EulerV2,
        validator: '0xa70f857762d188A87796000a2effb29080aF595E',
        vaults: [
          '0x95C5Fd8618C68D6156A739C1EAb5aA7c807ff148',
          '0x470379C4416300068E9Afb938b7A0cfF7735d42f',
          '0xc27d44A8aEA0CDa482600136c0d0876e807f6C1a',
        ],
      },
      {
        type: ValidatorTypeDto.VenusV4,
        validator: '0xdccEBb8BC784EdbBf38b0f4da3EC89d262CDC5F4',
        vaults: [
          '0xecA88125a5ADbe82614ffC12D0DB554E2e2867C8',
          '0xfD5840Cd36d94D7229439859C0112a4185BC0255',
          '0x0C1DA220D301155b87318B90692Da8dc43B67340',
        ],
      },
    ],
  },
  [NetworkDto.Base]: {
    saltNonce: SALT_NONCE,
    operator: '0x3E04BAFC29D2A6E7d1127cb2627beA34D3343B90',
    guard: '0xd3e648D925D56E7F49620C14A08172835749aB77',
    validators: [
      {
        type: ValidatorTypeDto.AerodromeCL,
        validator: '0xf9639e9fb22A28bFcD1D3598337bBB3B9e31809F',
        pools: [
          {
            address: '0xa41Bc0AFfbA7Fd420d186b84899d7ab2aC57fcD1',
            token0: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            token1: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2',
            tickSpacing: 1,
            tickLower: -10,
            tickUpper: 10,
          },
        ],
      },
      {
        type: ValidatorTypeDto.AaveV3,
        validator: '0x4D3CB1E122a513939728f4d09AceD5B43BaCe793',
        assets: [
          '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          '0xfde4c96c8593536e31f229ea8f37b2ada2699bb2',
        ],
      },
      {
        type: ValidatorTypeDto.EulerV2,
        validator: '0x715472Ff182B21fD8517A4827CEdC6c4AF9Bd5e6',
        vaults: [
          '0x9bD52F2805c6aF014132874124686e7b248c2Cbb',
          '0x313603FA690301b0CaeEf8069c065862f9162162',
        ],
      },
    ],
  },
};
