import { ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

import { AuthErrorCode } from './auth-error-code';
import { AuthException } from './auth.exception';
import { SUPPORTED_AUTH_PROVIDERS } from './dto/auth.dto';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(
    _err: unknown,
    user: TUser,
    _info: unknown,
    _context: ExecutionContext,
  ): TUser {
    if (user) {
      return user;
    }

    throw new AuthException(HttpStatus.UNAUTHORIZED, AuthErrorCode.AUTH_REQUIRED, {
      details: {
        reason: 'sign_in_required_for_cloud_features',
        supportedProviders: SUPPORTED_AUTH_PROVIDERS,
      },
    });
  }
}
