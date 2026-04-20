import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';

import { AuthErrorCode } from '../../auth/auth-error-code';
import { AuthException } from '../../auth/auth.exception';
import { PublicThrottleOptions, PUBLIC_THROTTLE_METADATA_KEY } from '../decorators/public-throttle.decorator';

type ThrottleEntry = {
  count: number;
  resetAt: number;
};

@Injectable()
export class PublicThrottleGuard implements CanActivate {
  private static readonly store = new Map<string, ThrottleEntry>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<PublicThrottleOptions>(
      PUBLIC_THROTTLE_METADATA_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!options) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const now = Date.now();
    const key = this.buildKey(request, options.scope);
    const windowMs = options.windowSeconds * 1000;
    const existing = PublicThrottleGuard.store.get(key);
    const entry =
      !existing || existing.resetAt <= now
        ? { count: 0, resetAt: now + windowMs }
        : existing;

    if (entry.count >= options.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      response.setHeader('Retry-After', String(retryAfterSeconds));

      throw new AuthException(HttpStatus.TOO_MANY_REQUESTS, AuthErrorCode.RATE_LIMITED, {
        details: {
          scope: options.scope,
          limit: options.limit,
          windowSeconds: options.windowSeconds,
          retryAfterSeconds,
        },
      });
    }

    entry.count += 1;
    PublicThrottleGuard.store.set(key, entry);
    return true;
  }

  static resetStore(): void {
    PublicThrottleGuard.store.clear();
  }

  private buildKey(request: Request, scope: string): string {
    const forwardedFor = request.headers['x-forwarded-for'];
    const forwarded =
      typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0]?.trim()
        : Array.isArray(forwardedFor)
          ? forwardedFor[0]
          : undefined;
    const ip = forwarded || request.ip || 'unknown';

    return `${scope}:${request.method}:${request.route?.path ?? request.path}:${ip}`;
  }
}
