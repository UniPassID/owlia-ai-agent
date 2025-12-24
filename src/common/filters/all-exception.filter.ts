import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  Logger,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';
import { BaseException, UnknownException } from '../exceptions/base.exception';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const req = ctx.getRequest();
    const { method, originalUrl, body } = req;

    const exceptionMessage =
      exception instanceof HttpException
        ? JSON.stringify(exception.getResponse())
        : '';
    this.logger.error(
      `[HTTP] ${method} ${originalUrl} ${response.statusCode} [${JSON.stringify(body)}] failed: ${exception} ${exceptionMessage}`,
      exception instanceof Error ? exception.stack : String,
    );

    let error: BaseException;

    if (exception instanceof BaseException) {
      error = exception;
    } else {
      error = new UnknownException();
    }

    response.json(error.toResponseDto());
  }
}
