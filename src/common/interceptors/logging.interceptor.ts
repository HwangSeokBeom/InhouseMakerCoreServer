import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, Observable, tap, throwError } from 'rxjs';

import {
  ensureRequestId,
  getExceptionDebugInfo,
  getRequesterUserId,
  getRequestPath,
  getRequestRoute,
  RequestDebugRequest,
  serializeLogPayload,
} from '../request-debug.util';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);
  private readonly requestDebugLogger = new Logger('RequestDebug');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestDebugRequest>();
    const startedAt = Date.now();
    const requestId = ensureRequestId(request);
    const method = request.method;
    const path = getRequestPath(request);
    const route = getRequestRoute(request);
    const requesterUserId = getRequesterUserId(request);

    this.requestDebugLogger.log(
      serializeLogPayload({
        requestId,
        method,
        path,
        route,
        requesterUserId,
        started: true,
      }),
    );

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const duration = Date.now() - startedAt;
        const statusCode = response.statusCode;

        this.logger.log(
          `${method} ${path} ${statusCode} ${duration}ms requestId=${requestId}`,
        );
        this.logRequestResult(statusCode, {
          requestId,
          method,
          path,
          route,
          requesterUserId,
          statusCode,
          durationMs: duration,
          outcome: statusCode >= HttpStatus.BAD_REQUEST ? 'http_error' : 'success',
        });
      }),
      catchError((error: unknown) => {
        const duration = Date.now() - startedAt;
        const exceptionDebug = getExceptionDebugInfo(error);
        const statusCode = exceptionDebug.statusCode;

        this.logRequestResult(statusCode, {
          requestId,
          method,
          path,
          route,
          requesterUserId,
          statusCode,
          durationMs: duration,
          outcome:
            statusCode >= HttpStatus.INTERNAL_SERVER_ERROR
              ? 'server_error'
              : 'client_error',
          code: exceptionDebug.code ?? null,
          reason: exceptionDebug.reason ?? null,
        });

        return throwError(() => error);
      }),
    );
  }

  private logRequestResult(
    statusCode: number,
    payload: Record<string, unknown>,
  ): void {
    const serializedPayload = serializeLogPayload(payload);

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.requestDebugLogger.error(serializedPayload);
      return;
    }

    if (statusCode >= HttpStatus.BAD_REQUEST) {
      this.requestDebugLogger.warn(serializedPayload);
      return;
    }

    this.requestDebugLogger.log(serializedPayload);
  }
}
