import { ExceptionFilter, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { Response } from 'express';
import { BaseException, UnknownException } from '../exceptions/base.exception';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const req = ctx.getRequest();
    const { method, originalUrl } = req;

    let error: BaseException;

    if (exception instanceof BaseException) {
      error = exception;
    } else {
      this.logger.error(
        `[HTTP] ${method} ${originalUrl} ${response.statusCode} failed: ${exception}`,
      );
      error = new UnknownException();
    }

    response.json(error.toResponseDto());
  }
}
