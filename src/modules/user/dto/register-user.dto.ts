import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { NetworkDto } from '../../../common/dto/network.dto';
import {
  ValidatorAaveV3ResponseDto,
  ValidatorAerodromeCLResponseDto,
  ValidatorEulerV2ResponseDto,
  ValidatorKyberSwapResponseDto,
  ValidatorResponseDto,
  ValidatorTypeDto,
  ValidatorUniswapV3ResponseDto,
  ValidatorVenusV4ResponseDto,
} from '../../deployment/dto/deployment.response.dto';
import {
  AssetNotSupportedException,
  PoolNotSupportedException,
  ValidatorNotSupportedException,
  VaultNotSupportedException,
} from '../../../common/exceptions/base.exception';
import {
  Address,
  AddressArray,
} from '../../../common/decorators/address.decorator';
import { Type } from 'class-transformer';

export class ValidatorUniswapV3PoolDto {
  @ApiProperty({
    description: 'The address of the pool',
    example: '0x1234567890abcdef',
  })
  @Address()
  address: string;
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

export class ValidatorUniswapV3Dto {
  @ApiProperty({
    description: 'The type of the validator',
    example: ValidatorTypeDto.UniswapV3,
  })
  type: ValidatorTypeDto.UniswapV3;

  @ApiProperty({
    description: 'The pools of the validator',
    type: [ValidatorUniswapV3PoolDto],
  })
  @Type(() => ValidatorUniswapV3PoolDto)
  pools: ValidatorUniswapV3PoolDto[];
}

export class ValidatorAerodromeCLPoolDto {
  @ApiProperty({
    description: 'The address of the pool',
    example: '0x1234567890abcdef',
  })
  @Address()
  address: string;
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

export class ValidatorAerodromeCLDto {
  @ApiProperty({
    description: 'The type of the validator',
    example: ValidatorTypeDto.AerodromeCL,
  })
  type: ValidatorTypeDto.AerodromeCL;

  @ApiProperty({
    description: 'The pools of the validator',
    type: [ValidatorAerodromeCLPoolDto],
  })
  @Type(() => ValidatorAerodromeCLPoolDto)
  pools: ValidatorAerodromeCLPoolDto[];
}

export class ValidatorAaveV3Dto {
  @ApiProperty({
    description: 'The type of the validator',
    example: ValidatorTypeDto.AaveV3,
  })
  type: ValidatorTypeDto.AaveV3;

  @ApiProperty({
    description: 'The assets of the validator',
    type: [String],
  })
  @AddressArray()
  assets: string[];
}

export class ValidatorEulerV2Dto {
  @ApiProperty({
    description: 'The type of the validator',
    example: ValidatorTypeDto.EulerV2,
  })
  type: ValidatorTypeDto.EulerV2;

  @AddressArray()
  @ApiProperty({
    description: 'The vaults of the validator',
    type: [String],
  })
  vaults: string[];
}

export class ValidatorVenusV4Dto {
  @ApiProperty({
    description: 'The type of the validator',
    example: ValidatorTypeDto.VenusV4,
  })
  type: ValidatorTypeDto.VenusV4;

  @ApiProperty({
    description: 'The vaults of the validator',
    type: [String],
  })
  @AddressArray()
  vaults: string[];
}

export class ValidatorKyberSwapDto {
  @ApiProperty({
    description: 'The type of the validator',
    example: ValidatorTypeDto.KyberSwap,
  })
  type: ValidatorTypeDto.KyberSwap;

  @ApiProperty({
    description: 'The tokens of the validator',
    type: [String],
  })
  @AddressArray()
  tokens: string[];
}

export type ValidatorDto =
  | ValidatorUniswapV3Dto
  | ValidatorAerodromeCLDto
  | ValidatorAaveV3Dto
  | ValidatorEulerV2Dto
  | ValidatorVenusV4Dto
  | ValidatorKyberSwapDto;

@ApiExtraModels(
  ValidatorUniswapV3Dto,
  ValidatorAerodromeCLDto,
  ValidatorAaveV3Dto,
  ValidatorEulerV2Dto,
  ValidatorVenusV4Dto,
  ValidatorKyberSwapDto,
)
export class RegisterUserDto {
  @ApiProperty({
    description: 'The network of the user',
    enum: NetworkDto,
    default: NetworkDto.Bsc,
  })
  network: NetworkDto;

  @ApiProperty({
    description: 'The owner of the user',
    example: '0x1234567890abcdef',
  })
  @Address()
  owner: string;

  @ApiProperty({
    description: 'The validators of the user',
    type: 'array',
    oneOf: [
      { $ref: getSchemaPath(ValidatorUniswapV3Dto) },
      { $ref: getSchemaPath(ValidatorAerodromeCLDto) },
      { $ref: getSchemaPath(ValidatorAaveV3Dto) },
      { $ref: getSchemaPath(ValidatorEulerV2Dto) },
      { $ref: getSchemaPath(ValidatorVenusV4Dto) },
      { $ref: getSchemaPath(ValidatorKyberSwapDto) },
    ],
  })
  @Type(() => Object, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'type',
      subTypes: [
        { value: ValidatorUniswapV3Dto, name: ValidatorTypeDto.UniswapV3 },
        { value: ValidatorAerodromeCLDto, name: ValidatorTypeDto.AerodromeCL },
        { value: ValidatorAaveV3Dto, name: ValidatorTypeDto.AaveV3 },
        { value: ValidatorEulerV2Dto, name: ValidatorTypeDto.EulerV2 },
        { value: ValidatorVenusV4Dto, name: ValidatorTypeDto.VenusV4 },
        { value: ValidatorKyberSwapDto, name: ValidatorTypeDto.KyberSwap },
      ],
    },
  })
  validators: ValidatorDto[];

  @ApiProperty({
    description: 'The registered signature of the user',
    example: '0x1234567890abcdef',
  })
  signature: string;
}

export function toValidatorResponseDto(
  network: NetworkDto,
  validators: ValidatorDto[],
  validatorResponses: ValidatorResponseDto[],
): ValidatorResponseDto[] {
  return validators.map((validator) => {
    switch (validator.type) {
      case ValidatorTypeDto.UniswapV3: {
        const validatorResponse = validatorResponses.find(
          (v) => v.type === ValidatorTypeDto.UniswapV3,
        );
        if (!validatorResponse) {
          throw new ValidatorNotSupportedException(network, validator.type);
        }

        const response = {
          type: ValidatorTypeDto.UniswapV3,
          validator: validatorResponse.validator,
          pools: validator.pools.map((p) => {
            const pool = validatorResponse.pools.find(
              (vp) => vp.address === p.address,
            );
            if (!pool) {
              throw new PoolNotSupportedException(network, p.address);
            }
            return {
              address: p.address,
              token0: pool.token0,
              token1: pool.token1,
              fee: pool.fee,
              tickLower: p.tickLower,
              tickUpper: p.tickUpper,
            };
          }),
        } as ValidatorUniswapV3ResponseDto;
        return response;
      }
      case ValidatorTypeDto.AerodromeCL: {
        const validatorResponse = validatorResponses.find(
          (v) => v.type === ValidatorTypeDto.AerodromeCL,
        );
        if (!validatorResponse) {
          throw new ValidatorNotSupportedException(network, validator.type);
        }

        const response = {
          type: ValidatorTypeDto.AerodromeCL,
          validator: validatorResponse.validator,
          pools: validator.pools.map((p) => {
            const pool = validatorResponse.pools.find(
              (vp) => vp.address === p.address,
            );
            if (!pool) {
              throw new PoolNotSupportedException(network, p.address);
            }
            return {
              address: p.address,
              token0: pool.token0,
              token1: pool.token1,
              tickSpacing: pool.tickSpacing,
              tickLower: p.tickLower,
              tickUpper: p.tickUpper,
            };
          }),
        } as ValidatorAerodromeCLResponseDto;
        return response;
      }
      case ValidatorTypeDto.AaveV3: {
        const validatorResponse = validatorResponses.find(
          (v) => v.type === ValidatorTypeDto.AaveV3,
        );
        if (!validatorResponse) {
          throw new ValidatorNotSupportedException(network, validator.type);
        }
        const response = {
          type: ValidatorTypeDto.AaveV3,
          validator: validatorResponse.validator,
          assets: validator.assets.map((a) => {
            const asset = validatorResponse.assets.find((va) => va === a);
            if (!asset) {
              throw new AssetNotSupportedException(network, a);
            }
            return asset;
          }),
        } as ValidatorAaveV3ResponseDto;
        return response;
      }
      case ValidatorTypeDto.EulerV2: {
        const validatorResponse = validatorResponses.find(
          (v) => v.type === ValidatorTypeDto.EulerV2,
        );
        if (!validatorResponse) {
          throw new ValidatorNotSupportedException(network, validator.type);
        }
        const response = {
          type: ValidatorTypeDto.EulerV2,
          validator: validatorResponse.validator,
          vaults: validator.vaults.map((v) => {
            const vault = validatorResponse.vaults.find((vv) => vv === v);
            if (!vault) {
              throw new VaultNotSupportedException(network, v);
            }
            return vault;
          }),
        } as ValidatorEulerV2ResponseDto;
        return response;
      }
      case ValidatorTypeDto.VenusV4: {
        const validatorResponse = validatorResponses.find(
          (v) => v.type === ValidatorTypeDto.VenusV4,
        );
        if (!validatorResponse) {
          throw new ValidatorNotSupportedException(network, validator.type);
        }
        const response = {
          type: ValidatorTypeDto.VenusV4,
          validator: validatorResponse.validator,
          vaults: validator.vaults.map((v) => {
            const vault = validatorResponse.vaults.find((vv) => vv === v);
            if (!vault) {
              throw new VaultNotSupportedException(network, v);
            }
            return vault;
          }),
        } as ValidatorVenusV4ResponseDto;
        return response;
      }
      case ValidatorTypeDto.KyberSwap: {
        const validatorResponse = validatorResponses.find(
          (v) => v.type === ValidatorTypeDto.KyberSwap,
        );
        if (!validatorResponse) {
          throw new ValidatorNotSupportedException(network, validator.type);
        }
        const response = {
          type: ValidatorTypeDto.KyberSwap,
          validator: validatorResponse.validator,
          tokens: validator.tokens.map((t) => {
            const token = validatorResponse.tokens.find((vt) => vt === t);
            if (!token) {
              throw new AssetNotSupportedException(network, t);
            }
            return token;
          }),
        } as ValidatorKyberSwapResponseDto;
        return response;
      }
    }
  });
}
