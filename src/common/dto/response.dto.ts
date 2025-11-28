import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  getSchemaPath,
} from '@nestjs/swagger';

export enum ResponseCodeDto {
  Success = 0,

  NetworkNotSupported = 4001,
  InvalidSignature = 4002,
  UserAlreadyRegistered = 4003,
  ValidatorNotSupported = 4004,
  PoolNotSupported = 4005,
  AssetNotSupported = 4006,
  VaultNotSupported = 4007,
  UserNotFound = 4008,
  InvalidParameter = 4009,

  UnknownError = 10000,
}

export class ResponseDto<T> {
  @ApiProperty({
    description: 'The code of the response',
    enum: ResponseCodeDto,
    default: ResponseCodeDto.Success,
  })
  code: ResponseCodeDto;

  @ApiProperty({
    description: 'The data of the response',
    type: Object,
  })
  data: T;

  @ApiProperty({
    description: 'The message of the response',
    type: String,
    default: 'success',
  })
  message: string;
}

export function ApiResponseSchema(model: any) {
  return {
    schema: {
      allOf: [
        { $ref: getSchemaPath(ResponseDto) },
        {
          properties: {
            data: { $ref: getSchemaPath(model) },
          },
        },
      ],
    },
  };
}

export function ApiOk<T>(model: new () => T) {
  return applyDecorators(
    // 自动注册 Swagger 组件
    ApiExtraModels(ResponseDto, model),
    ApiOkResponse({
      schema: {
        allOf: [
          { $ref: getSchemaPath(ResponseDto) },
          {
            properties: {
              data: { $ref: getSchemaPath(model) },
            },
          },
        ],
      },
    }),
  );
}
