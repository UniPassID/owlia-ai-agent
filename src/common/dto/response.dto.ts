import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiProperty,
  getSchemaPath,
} from '@nestjs/swagger';

export enum ResponseCodeDto {
  Success = 0,
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
