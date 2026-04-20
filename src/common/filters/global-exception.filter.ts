import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

import { AuthErrorCode } from '../../auth/auth-error-code';
import { AppErrorCode } from '../app.exception';
import {
  formatHomeRequestDebugMessage,
  ensureRequestId,
  getRequesterUserId,
  getRequestPath,
  getRequestRoute,
  RequestDebugRequest,
  serializeLogPayload,
  shouldLogHomeRequestDebug,
} from '../request-debug.util';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);
  private readonly errorDebugLogger = new Logger('ErrorDebug');
  private readonly homeRequestDebugLogger = new Logger('HomeRequestDebug');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestDebugRequest>();
    const requestId = ensureRequestId(request);

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
    const prismaDebug = this.extractPrismaDebugMetadata(exception);

    this.logExceptionDebug(
      status,
      {
        requestId,
        method: request.method,
        path: getRequestPath(request),
        route: getRequestRoute(request),
        requesterUserId: getRequesterUserId(request),
        statusCode: status,
        code: code ?? null,
        message,
        reason: details.reason ?? null,
        exceptionName: exception instanceof Error ? exception.name : typeof exception,
        ...prismaDebug,
      },
      exception,
    );
    this.logHomeRequestDebug(request, status, details);

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

  private logExceptionDebug(
    statusCode: number,
    payload: Record<string, unknown>,
    exception: unknown,
  ): void {
    const serializedPayload = serializeLogPayload(payload);

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.errorDebugLogger.error(
        serializedPayload,
        exception instanceof Error ? exception.stack : undefined,
      );
      return;
    }

    this.errorDebugLogger.warn(serializedPayload);
  }

  private logHomeRequestDebug(
    request: RequestDebugRequest,
    statusCode: number,
    details: Record<string, unknown>,
  ): void {
    if (
      (statusCode !== HttpStatus.FORBIDDEN && statusCode !== HttpStatus.NOT_FOUND) ||
      !shouldLogHomeRequestDebug(getRequestPath(request), getRequestRoute(request))
    ) {
      return;
    }

    const probableCause = details.probableCause;

    if (
      typeof probableCause !== 'string' ||
      probableCause !== 'stale_client_reference' &&
      probableCause !== 'not_member'
    ) {
      return;
    }

    const fixtureHint =
      details.fixtureHint === 'removed_fixture' ? 'removed_fixture' : null;
    const reason = typeof details.reason === 'string' ? details.reason : null;

    this.homeRequestDebugLogger.warn(
      formatHomeRequestDebugMessage({
        requesterUserId: getRequesterUserId(request),
        path: getRequestPath(request),
        outcome: statusCode === HttpStatus.FORBIDDEN ? 'forbidden' : 'not_found',
        probableCause,
        fixtureHint,
        reason,
      }),
    );
  }

  private extractPrismaDebugMetadata(exception: unknown): Record<string, unknown> {
    if (!(exception instanceof Prisma.PrismaClientKnownRequestError)) {
      return {};
    }

    const meta =
      exception.meta && typeof exception.meta === 'object'
        ? (exception.meta as Record<string, unknown>)
        : {};
    const target = Array.isArray(meta.target)
      ? meta.target.filter((value): value is string => typeof value === 'string')
      : null;

    return {
      prismaCode: exception.code,
      prismaModelName: typeof meta.modelName === 'string' ? meta.modelName : null,
      prismaColumn: typeof meta.column === 'string' ? meta.column : null,
      prismaTable: typeof meta.table === 'string' ? meta.table : null,
      prismaTarget: target,
      probableCause: exception.code === 'P2022' ? 'database_schema_mismatch' : null,
    };
  }
}
