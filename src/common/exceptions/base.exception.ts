import { ResponseCodeDto, ResponseDto } from '../dto/response.dto';

export class BaseException extends Error {
  public readonly code: ResponseCodeDto;

  constructor(code: ResponseCodeDto, message: string) {
    super(message);
    this.code = code;
  }

  toResponseDto(): ResponseDto<null> {
    return {
      code: this.code,
      message: this.message,
      data: null,
    };
  }
}

export class UnknownException extends BaseException {
  constructor() {
    super(ResponseCodeDto.UnknownError, 'Unknown error');
  }
}
