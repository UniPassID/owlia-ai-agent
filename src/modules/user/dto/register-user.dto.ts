import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { NetworkDto } from '../../../common/dto/network.dto';
import {
  ValidatorAaveV3ResponseDto,
  ValidatorEulerV2ResponseDto,
  ValidatorResponseDto,
  ValidatorProtocolDto,
  ValidatorTypeDto,
  ValidatorOkxSwapResponseDto,
} from '../../deployment/dto/deployment.response.dto';
import {
  AssetNotSupportedException,
  MarketNotSupportedException,
  ValidatorNotSupportedException,
} from '../../../common/exceptions/base.exception';
import { Address } from '../../../common/decorators/address.decorator';
import { Type } from 'class-transformer';
import { IsEnum, IsString, IsArray, ValidateNested } from 'class-validator';

export class ValidatorLendingMarketDto {
  @ApiProperty({
    description: 'The contract address of the market',
    example: '0x1234567890abcdef',
  })
  @IsString()
  @Address()
  contract: string;
}

export class ValidatorAaveV3Dto {
  @ApiProperty({
    description: 'The type of the validator',
    example: ValidatorProtocolDto.AaveV3,
  })
  @IsEnum(ValidatorProtocolDto)
  protocol: ValidatorProtocolDto.AaveV3;

  @ApiProperty({
    description: 'The assets of the validator',
    type: [ValidatorLendingMarketDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ValidatorLendingMarketDto)
  markets: ValidatorLendingMarketDto[];
}

export class ValidatorEulerV2Dto {
  @ApiProperty({
    description: 'The type of the validator',
    example: ValidatorProtocolDto.EulerV2,
  })
  @IsEnum(ValidatorProtocolDto)
  protocol: ValidatorProtocolDto.EulerV2;

  @ApiProperty({
    description: 'The vaults of the validator',
    type: [ValidatorLendingMarketDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ValidatorLendingMarketDto)
  markets: ValidatorLendingMarketDto[];
}

export class ValidatorSwapAssetDto {
  @ApiProperty({
    description: 'The contract address of the asset',
    example: '0x1234567890abcdef',
  })
  @IsString()
  @Address()
  contract: string;
}

export class ValidatorOkxSwapDto {
  @ApiProperty({
    description: 'The type of the validator',
    example: ValidatorProtocolDto.OkxSwap,
  })
  @IsEnum(ValidatorProtocolDto)
  protocol: ValidatorProtocolDto.OkxSwap;

  @ApiProperty({
    description: 'The assets of the validator',
    type: [ValidatorSwapAssetDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ValidatorSwapAssetDto)
  assets: ValidatorSwapAssetDto[];
}

export type ValidatorDto =
  | ValidatorAaveV3Dto
  | ValidatorEulerV2Dto
  | ValidatorOkxSwapDto;

@ApiExtraModels(ValidatorAaveV3Dto, ValidatorEulerV2Dto, ValidatorOkxSwapDto)
export class DeploymentDto {
  @ApiProperty({
    description: 'The network of the deployment',
    enum: NetworkDto,
    default: NetworkDto.Base,
  })
  @IsEnum(NetworkDto)
  network: NetworkDto;

  @ApiProperty({
    description: 'The validators of the user',
    type: 'array',
    oneOf: [
      { $ref: getSchemaPath(ValidatorAaveV3Dto) },
      { $ref: getSchemaPath(ValidatorEulerV2Dto) },
      { $ref: getSchemaPath(ValidatorOkxSwapDto) },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => Object, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: 'protocol',
      subTypes: [
        { value: ValidatorAaveV3Dto, name: ValidatorProtocolDto.AaveV3 },
        {
          value: ValidatorEulerV2Dto,
          name: ValidatorProtocolDto.EulerV2,
        },
        { value: ValidatorOkxSwapDto, name: ValidatorProtocolDto.OkxSwap },
      ],
    },
  })
  validators: ValidatorDto[];

  @ApiProperty({
    description: 'The registered signature of the user',
    example: '0x1234567890abcdef',
  })
  @IsString()
  signature: string;
}

export class RegisterUserDto {
  @ApiProperty({
    description: 'The owner of the user',
    example: '0x1234567890abcdef',
  })
  @IsString()
  @Address()
  owner: string;

  @ApiProperty({
    description: 'The deployments of the user',
    type: [DeploymentDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  deployments: DeploymentDto[];
}

export function toValidatorResponseDto(
  network: NetworkDto,
  validators: ValidatorDto[],
  validatorResponses: ValidatorResponseDto[],
): ValidatorResponseDto[] {
  return validators.map((validator) => {
    switch (validator.protocol) {
      case ValidatorProtocolDto.AaveV3: {
        const validatorResponse = validatorResponses.find(
          (v) => v.protocol === ValidatorProtocolDto.AaveV3,
        );
        if (!validatorResponse) {
          throw new ValidatorNotSupportedException(network, validator.protocol);
        }
        const response = {
          type: ValidatorTypeDto.Lending,
          protocol: ValidatorProtocolDto.AaveV3,
          name: validatorResponse.name,
          validator: validatorResponse.validator,
          targets: validatorResponse.targets,
          markets: validator.markets.map((m) => {
            const market = validatorResponse.markets.find(
              (vm) => vm.contract === m.contract,
            );
            if (!market) {
              throw new MarketNotSupportedException(
                network,
                validator.protocol,
                m.contract,
              );
            }
            return market;
          }),
        } satisfies ValidatorAaveV3ResponseDto;
        return response;
      }
      case ValidatorProtocolDto.EulerV2: {
        const validatorResponse = validatorResponses.find(
          (v) => v.protocol === ValidatorProtocolDto.EulerV2,
        );
        if (!validatorResponse) {
          throw new ValidatorNotSupportedException(network, validator.protocol);
        }
        const response = {
          type: ValidatorTypeDto.Lending,
          protocol: ValidatorProtocolDto.EulerV2,
          name: validatorResponse.name,
          validator: validatorResponse.validator,
          targets: validatorResponse.targets,
          markets: validator.markets.map((m) => {
            const market = validatorResponse.markets.find(
              (vm) => vm.contract === m.contract,
            );
            if (!market) {
              throw new MarketNotSupportedException(
                network,
                validator.protocol,
                m.contract,
              );
            }
            return market;
          }),
        } satisfies ValidatorEulerV2ResponseDto;
        return response;
      }
      case ValidatorProtocolDto.OkxSwap: {
        const validatorResponse = validatorResponses.find(
          (v) => v.protocol === ValidatorProtocolDto.OkxSwap,
        );
        if (!validatorResponse) {
          throw new ValidatorNotSupportedException(network, validator.protocol);
        }
        const response = {
          type: ValidatorTypeDto.Swap,
          protocol: ValidatorProtocolDto.OkxSwap,
          name: validatorResponse.name,
          validator: validatorResponse.validator,
          targets: validatorResponse.targets,
          assets: validator.assets.map((a) => {
            const asset = validatorResponse.assets.find(
              (va) => va.contract === a.contract,
            );
            if (!asset) {
              throw new AssetNotSupportedException(
                network,
                validator.protocol,
                a.contract,
              );
            }
            return asset;
          }),
        } satisfies ValidatorOkxSwapResponseDto;
        return response;
      }
    }
  });
}
