import { ExceptionFilter, Catch, ArgumentsHost } from '@nestjs/common';
import { Response } from 'express';
import { BaseException, UnknownException } from '../exceptions/base.exception';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let error: BaseException;

    if (exception instanceof BaseException) {
      error = exception;
    } else {
      error = new UnknownException();
    }

    response.json(error.toResponseDto());
  }
}
