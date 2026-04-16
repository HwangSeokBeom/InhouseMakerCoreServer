import { HttpException, HttpStatus } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';

import { AUTH_ERROR_MESSAGES, AuthErrorCode } from './auth-error-code';
import { toAuthProviderResponse } from './dto/auth.dto';

export interface AuthExceptionOptions {
  message?: string;
  provider?: AuthProvider;
  details?: Record<string, unknown>;
}

export class AuthException extends HttpException {
  constructor(
    status: HttpStatus,
    errorCode: AuthErrorCode,
    options: AuthExceptionOptions = {},
  ) {
    const normalizedProvider = toAuthProviderResponse(options.provider);
    const details = options.details
      ? {
          ...options.details,
          ...(options.details.provider
            ? {
                provider:
                  typeof options.details.provider === 'string'
                    ? options.details.provider.toLowerCase()
                    : toAuthProviderResponse(options.details.provider as AuthProvider),
              }
            : {}),
          ...(Array.isArray(options.details.availableProviders)
            ? {
                availableProviders: options.details.availableProviders.map((provider) =>
                  typeof provider === 'string'
                    ? provider.toLowerCase()
                    : toAuthProviderResponse(provider as AuthProvider),
                ),
              }
            : {}),
          ...(Array.isArray(options.details.supportedProviders)
            ? {
                supportedProviders: options.details.supportedProviders.map((provider) =>
                  typeof provider === 'string'
                    ? provider.toLowerCase()
                    : toAuthProviderResponse(provider as AuthProvider),
                ),
              }
            : {}),
        }
      : undefined;

    super(
      {
        success: false,
        code: errorCode,
        message: options.message ?? AUTH_ERROR_MESSAGES[errorCode],
        provider: normalizedProvider,
        ...(details ? { details } : {}),
      },
      status,
    );
  }
}
