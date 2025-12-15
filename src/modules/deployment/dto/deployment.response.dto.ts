import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';

export enum ValidatorTypeDto {
  UniswapV3 = 'uniswap-v3',
  AerodromeCL = 'aerodrome-cl',
  AaveV3 = 'aave-v3',
  EulerV2 = 'euler-v2',
  VenusV4 = 'venus-v4',
  KyberSwap = 'kyber-swap',
  OkxSwap = 'okx-swap',
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

export class ValidatorOkxSwapResponseDto {
  @ApiProperty({
    description: 'The type of the protocol',
    example: 'okx-swap',
  })
  type: ValidatorTypeDto.OkxSwap;

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
  | ValidatorKyberSwapResponseDto
  | ValidatorOkxSwapResponseDto;

@ApiExtraModels(
  ValidatorUniswapV3ResponseDto,
  ValidatorAerodromeCLResponseDto,
  ValidatorAaveV3ResponseDto,
  ValidatorEulerV2ResponseDto,
  ValidatorVenusV4ResponseDto,
  ValidatorKyberSwapResponseDto,
  ValidatorOkxSwapResponseDto,
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
    type: 'array',
    oneOf: [
      { $ref: getSchemaPath(ValidatorUniswapV3ResponseDto) },
      { $ref: getSchemaPath(ValidatorAerodromeCLResponseDto) },
      { $ref: getSchemaPath(ValidatorAaveV3ResponseDto) },
      { $ref: getSchemaPath(ValidatorEulerV2ResponseDto) },
      { $ref: getSchemaPath(ValidatorVenusV4ResponseDto) },
      { $ref: getSchemaPath(ValidatorKyberSwapResponseDto) },
      { $ref: getSchemaPath(ValidatorOkxSwapResponseDto) },
    ],
  })
  validators: ValidatorResponseDto[];
}
