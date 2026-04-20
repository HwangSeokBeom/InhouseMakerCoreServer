import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AuthErrorCode } from './auth-error-code';
import { AuthException } from './auth.exception';
import { SUPPORTED_AUTH_PROVIDERS } from './dto/auth.dto';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  handleRequest<TUser = unknown>(
    _err: unknown,
    user: TUser,
    _info: unknown,
    _context: ExecutionContext,
  ): TUser {
    if (_err instanceof HttpException) {
      throw _err;
    }

    if (user) {
      return user;
    }

    this.logRecruitingPostDetailAuthFailure(_context);

    throw new AuthException(HttpStatus.UNAUTHORIZED, AuthErrorCode.AUTH_REQUIRED, {
      details: {
        reason: 'sign_in_required_for_cloud_features',
        supportedProviders: SUPPORTED_AUTH_PROVIDERS,
      },
    });
  }

  private logRecruitingPostDetailAuthFailure(context: ExecutionContext): void {
    if (typeof context?.switchToHttp !== 'function') {
      return;
    }

    const request = context.switchToHttp().getRequest<{
      method?: string;
      originalUrl?: string;
      url?: string;
      params?: Record<string, string | undefined>;
    }>();
    const method = request?.method ?? '';
    const path = request?.originalUrl ?? request?.url ?? '';
    const requestedPostId = request?.params?.postId ?? this.extractRecruitingPostId(path);

    if (
      method !== 'GET' ||
      !requestedPostId ||
      path.includes('/public') ||
      path.endsWith('/apply') ||
      path.endsWith('/applicants')
    ) {
      return;
    }

    this.logger.warn(
      `recruiting_post_detail_access ${JSON.stringify({
        requestedPostId,
        requesterUserId: null,
        authPresent: false,
        foundPost: null,
        deniedReason: 'auth_required',
        returnedStatusCode: 401,
      })}`,
    );
  }

  private extractRecruitingPostId(path: string): string | null {
    const match = path.match(/^\/?recruiting-posts\/([^/?]+)(?:\?.*)?$/);
    return match?.[1] ?? null;
  }
}
