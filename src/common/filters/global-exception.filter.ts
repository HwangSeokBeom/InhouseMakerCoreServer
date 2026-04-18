import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

import { AuthErrorCode } from '../../auth/auth-error-code';
import { AppErrorCode } from '../app.exception';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse = isHttpException ? exception.getResponse() : null;
    const responseBody =
      typeof exceptionResponse === 'string'
        ? { message: exceptionResponse }
        : (exceptionResponse as Record<string, unknown> | null) ?? {};
    const rawMessage =
      responseBody.message ??
      (exception instanceof Error ? exception.message : 'Internal server error');
    const message = Array.isArray(rawMessage) ? rawMessage.join(', ') : rawMessage;
    const details =
      responseBody.details && typeof responseBody.details === 'object'
        ? (responseBody.details as Record<string, unknown>)
        : {};
    const code =
      typeof responseBody.code === 'string'
        ? responseBody.code
        : typeof responseBody.errorCode === 'string'
          ? responseBody.errorCode
          : status === HttpStatus.BAD_REQUEST
            ? AppErrorCode.VALIDATION_ERROR
            : status === HttpStatus.CONFLICT
              ? AppErrorCode.INVALID_REQUEST
            : status === HttpStatus.UNAUTHORIZED
              ? AppErrorCode.AUTH_REQUIRED
              : status === HttpStatus.NOT_FOUND
                ? AppErrorCode.NOT_FOUND
              : status === HttpStatus.TOO_MANY_REQUESTS
                ? AuthErrorCode.RATE_LIMITED
              : status === HttpStatus.FORBIDDEN
                ? AppErrorCode.FORBIDDEN
              : status === HttpStatus.INTERNAL_SERVER_ERROR
                ? AuthErrorCode.INTERNAL_SERVER_ERROR
                : undefined;

    if (!isHttpException) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      ...responseBody,
      provider:
        responseBody.provider === undefined ? null : responseBody.provider,
      details,
      ...(code ? { code } : {}),
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
