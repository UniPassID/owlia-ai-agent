import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { IsArray, IsEnum, ValidateNested } from 'class-validator';
import { NetworkDto } from '../../../common/dto/network.dto';

export enum ValidatorProtocolDto {
  AaveV3 = 'aave-v3',
  EulerV2 = 'euler-v2',
  OkxSwap = 'okx-swap',
}

export enum ValidatorTypeDto {
  Lending = 'lending',
  Swap = 'swap',
}

export class ValidatorLendingMarketDto {
  @ApiProperty({
    description: 'The contract address of the market',
    example: '0x1234567890abcdef',
  })
  contract: string;
}

export class ValidatorSwapAssetResponseDto {
  @ApiProperty({
    description: 'The contract address of the token',
    example: '0x1234567890abcdef',
  })
  contract: string;

  @ApiProperty({
    description: 'The name of the token',
    example: 'USDC',
  })
  name: string;

  @ApiProperty({
    description: 'The symbol of the token',
    example: 'USDC',
  })
  symbol: string;
}

export class ValidatorAaveV3ResponseDto {
  @ApiProperty({
    description: 'The type of the validator',
    example: ValidatorTypeDto.Lending,
  })
  type: ValidatorTypeDto.Lending;

  @ApiProperty({
    description: 'The protocol of the validator',
    example: ValidatorProtocolDto.AaveV3,
  })
  protocol: ValidatorProtocolDto.AaveV3;

  @ApiProperty({
    description: 'The name of the validator',
    example: 'Aave',
  })
  name: 'Aave';

  @ApiProperty({
    description: 'The validator of the protocol',
    example: '0x1234567890abcdef',
  })
  validator: string;

  @ApiProperty({
    description: 'The targets of the validator',
    type: [String],
  })
  targets: string[];

  @ApiProperty({
    description: 'The markets of the protocol',
    type: [ValidatorLendingMarketDto],
  })
  markets: ValidatorLendingMarketDto[];
}

export class ValidatorEulerV2ResponseDto {
  @ApiProperty({
    description: 'The type of the protocol',
    example: ValidatorTypeDto.Lending,
  })
  type: ValidatorTypeDto.Lending;

  @ApiProperty({
    description: 'The protocol of the validator',
    example: ValidatorProtocolDto.EulerV2,
  })
  protocol: ValidatorProtocolDto.EulerV2;

  @ApiProperty({
    description: 'The name of the validator',
    example: 'Euler',
  })
  name: 'Euler';

  @ApiProperty({
    description: 'The validator of the protocol',
    example: '0x1234567890abcdef',
  })
  validator: string;

  @ApiProperty({
    description: 'The targets of the validator',
    type: [String],
  })
  targets: string[];

  @ApiProperty({
    description: 'The markets of the protocol',
    type: [ValidatorLendingMarketDto],
  })
  markets: ValidatorLendingMarketDto[];
}

export class ValidatorOkxSwapResponseDto {
  @ApiProperty({
    description: 'The type of the protocol',
    example: ValidatorTypeDto.Swap,
  })
  type: ValidatorTypeDto.Swap;

  @ApiProperty({
    description: 'The protocol of the validator',
    example: ValidatorProtocolDto.OkxSwap,
  })
  protocol: ValidatorProtocolDto.OkxSwap;

  @ApiProperty({
    description: 'The name of the validator',
    example: 'OKX Swap',
  })
  name: 'OKX Swap';

  @ApiProperty({
    description: 'The validator of the protocol',
    example: '0x1234567890abcdef',
  })
  validator: string;

  @ApiProperty({
    description: 'The targets of the validator',
    type: [String],
    example: ['0x4409921Ae43a39a11D90F7B7F96cfd0B8093d9fC'],
  })
  targets: string[];

  @ApiProperty({
    description: 'The assets of the protocol',
    type: [ValidatorSwapAssetResponseDto],
  })
  assets: ValidatorSwapAssetResponseDto[];
}

export type ValidatorResponseDto =
  | ValidatorAaveV3ResponseDto
  | ValidatorEulerV2ResponseDto
  | ValidatorOkxSwapResponseDto;

@ApiExtraModels(
  ValidatorAaveV3ResponseDto,
  ValidatorEulerV2ResponseDto,
  ValidatorOkxSwapResponseDto,
)
export class DeploymentConfigResponseDto {
  @ApiProperty({
    description: 'The network of the deployment config',
    example: NetworkDto.Base,
  })
  @IsEnum(NetworkDto)
  network: NetworkDto;

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
      { $ref: getSchemaPath(ValidatorAaveV3ResponseDto) },
      { $ref: getSchemaPath(ValidatorEulerV2ResponseDto) },
      { $ref: getSchemaPath(ValidatorOkxSwapResponseDto) },
    ],
  })
  validators: ValidatorResponseDto[];
}

export class DeploymentConfigsResponseDto {
  @ApiProperty({
    description: 'The deployment configs',
    type: [DeploymentConfigResponseDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  configs: DeploymentConfigResponseDto[];
}
