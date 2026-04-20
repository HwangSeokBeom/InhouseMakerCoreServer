import 'reflect-metadata';

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  INestApplication,
  Module,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';

import { AppErrorCode } from '../src/common/app.exception';
import { PublicThrottleGuard } from '../src/common/guards/public-throttle.guard';
import { AuthController } from '../src/auth/auth.controller';
import { AuthErrorCode } from '../src/auth/auth-error-code';
import { AuthService } from '../src/auth/auth.service';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

function collectRoutes(stack: any[] | undefined, routes: string[] = []): string[] {
  if (!Array.isArray(stack)) {
    return routes;
  }

  for (const layer of stack) {
    if (layer?.route?.path && layer.route.methods) {
      const methods = Object.keys(layer.route.methods)
        .filter((method) => layer.route.methods[method])
        .map((method) => method.toUpperCase());
      methods.forEach((method) => routes.push(`${method} ${layer.route.path}`));
      continue;
    }

    if (Array.isArray(layer?.handle?.stack)) {
      collectRoutes(layer.handle.stack, routes);
    }
  }

  return routes;
}

describe('AuthController HTTP contract', () => {
  let app: INestApplication;

  const authService = {
    rejectEmailAuthDisabled: jest.fn(async () => {
      throw new HttpException(
        {
          success: false,
          code: AuthErrorCode.EMAIL_AUTH_DISABLED,
          message: 'Legacy email verification flow is disabled.',
          provider: 'email',
        },
        HttpStatus.GONE,
      );
    }),
    rejectLegacyAuthRoute: jest.fn(async (route: string, replacementPath?: string) => {
      throw new HttpException(
        {
          success: false,
          code: AuthErrorCode.LEGACY_AUTH_ROUTE_DISABLED,
          message: `Legacy auth route is disabled. Use POST ${replacementPath}.`,
          provider: 'email',
          details: {
            route,
            replacementPath,
          },
        },
        HttpStatus.GONE,
      );
    }),
    signupWithEmail: jest.fn(async (dto: Record<string, unknown>) => ({
      user: {
        id: 'u_1',
        email: dto.email,
        nickname: dto.nickname,
        provider: 'email',
        status: 'ACTIVE',
      },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    })),
    loginWithEmail: jest.fn(async () => ({
      user: {
        id: 'u_1',
        email: 'member@example.com',
        nickname: 'Member',
        provider: 'email',
        status: 'ACTIVE',
      },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    })),
    loginWithApple: jest.fn(async () => ({
      user: {
        id: 'u_apple',
        email: 'apple@example.com',
        nickname: 'AppleUser',
        provider: 'apple',
        status: 'ACTIVE',
      },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    })),
    loginWithGoogle: jest.fn(async () => ({
      user: {
        id: 'u_google',
        email: 'google@example.com',
        nickname: 'GoogleUser',
        provider: 'google',
        status: 'ACTIVE',
      },
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    })),
    refresh: jest.fn(async () => ({
      user: {
        id: 'u_1',
        email: 'member@example.com',
        nickname: 'Member',
        provider: 'email',
        status: 'ACTIVE',
      },
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    })),
    logout: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    @Module({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: authService,
        },
        {
          provide: PublicThrottleGuard,
          useValue: {
            canActivate: jest.fn(() => true),
          },
        },
        {
          provide: JwtAuthGuard,
          useValue: {
            canActivate: jest.fn(() => true),
          },
        },
      ],
    })
    class AuthControllerTestModule {}

    app = await NestFactory.create(AuthControllerTestModule, { logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
        exceptionFactory: (errors: ValidationError[]) =>
          new BadRequestException({
            success: false,
            code: AppErrorCode.VALIDATION_ERROR,
            message: 'Payload is invalid.',
            details: {
              validationErrors: errors.flatMap((error) =>
                Object.values(error.constraints ?? {}).map((constraint) => ({
                  field: error.property,
                  message: constraint,
                })),
              ),
            },
          }),
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers the official and legacy auth routes', () => {
    const adapter = app.getHttpAdapter().getInstance() as {
      router?: { stack?: any[] };
      _router?: { stack?: any[] };
    };
    const routes = collectRoutes(adapter.router?.stack ?? adapter._router?.stack);

    expect(routes).toEqual(
      expect.arrayContaining([
        'POST /auth/signup',
        'POST /auth/signup/email',
        'POST /auth/login/email',
        'POST /auth/login/apple',
        'POST /auth/login/google',
        'POST /auth/refresh',
        'POST /auth/logout',
      ]),
    );
  });

  it('accepts POST /auth/signup when the required consent fields are present', async () => {
    const response = await request(app.getHttpServer()).post('/auth/signup').send({
      email: 'new@example.com',
      password: 'Password1',
      nickname: 'Newbie',
      agreedToTerms: true,
      agreedToPrivacy: true,
    });

    expect(response.status).toBe(200);
    expect(authService.signupWithEmail).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'Password1',
      nickname: 'Newbie',
      agreedToTerms: true,
      agreedToPrivacy: true,
    });
  });

  it('rejects POST /auth/signup when agreedToTerms is missing with a field-level validation error', async () => {
    const response = await request(app.getHttpServer()).post('/auth/signup').send({
      email: 'new@example.com',
      password: 'Password1',
      nickname: 'Newbie',
      agreedToPrivacy: true,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: AppErrorCode.VALIDATION_ERROR,
      message: 'Payload is invalid.',
    });
    expect(response.body.details.validationErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'agreedToTerms',
          message: 'agreedToTerms is required.',
        }),
      ]),
    );
    expect(authService.signupWithEmail).not.toHaveBeenCalled();
  });

  it('rejects POST /auth/signup when agreedToPrivacy is missing with a field-level validation error', async () => {
    const response = await request(app.getHttpServer()).post('/auth/signup').send({
      email: 'new@example.com',
      password: 'Password1',
      nickname: 'Newbie',
      agreedToTerms: true,
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: AppErrorCode.VALIDATION_ERROR,
      message: 'Payload is invalid.',
    });
    expect(response.body.details.validationErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'agreedToPrivacy',
          message: 'agreedToPrivacy is required.',
        }),
      ]),
    );
    expect(authService.signupWithEmail).not.toHaveBeenCalled();
  });

  it('rejects invalid POST /auth/signup payloads at the controller boundary', async () => {
    const response = await request(app.getHttpServer()).post('/auth/signup').send({
      email: 'not-an-email',
      password: 'short',
      nickname: 'N',
      agreedToTerms: true,
      agreedToPrivacy: true,
      extraField: 'blocked',
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: AppErrorCode.VALIDATION_ERROR,
      message: 'Payload is invalid.',
    });
    expect(response.body.details.validationErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'email' }),
        expect.objectContaining({ field: 'password' }),
        expect.objectContaining({ field: 'nickname' }),
        expect.objectContaining({ field: 'extraField' }),
      ]),
    );
  });

  it('returns 410 for the legacy POST /auth/signup/email alias with a replacement path', async () => {
    const response = await request(app.getHttpServer()).post('/auth/signup/email').send({
      email: 'legacy@example.com',
      password: 'Password1',
      nickname: 'Legacy',
      agreedToTerms: true,
      agreedToPrivacy: true,
    });

    expect(response.status).toBe(410);
    expect(authService.rejectLegacyAuthRoute).toHaveBeenCalledWith(
      '/auth/signup/email',
      '/auth/signup',
    );
    expect(response.body).toMatchObject({
      code: AuthErrorCode.LEGACY_AUTH_ROUTE_DISABLED,
      details: {
        route: '/auth/signup/email',
        replacementPath: '/auth/signup',
      },
    });
  });

  it('rejects POST /auth/login/apple when identityToken is missing', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login/apple').send({});

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: AppErrorCode.VALIDATION_ERROR,
    });
  });

  it('accepts POST /auth/login/google when the body contains only identityToken', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login/google').send({
      identityToken: 'google-identity-token',
    });

    expect(response.status).toBe(200);
    expect(authService.loginWithGoogle).toHaveBeenCalledWith({
      identityToken: 'google-identity-token',
    });
  });

  it('rejects POST /auth/login/google when additional body fields are provided', async () => {
    const response = await request(app.getHttpServer()).post('/auth/login/google').send({
      identityToken: 'google-identity-token',
      authorizationCode: 'not-supported',
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      code: AppErrorCode.VALIDATION_ERROR,
      message: 'Payload is invalid.',
    });
    expect(response.body.details.validationErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'authorizationCode',
        }),
      ]),
    );
    expect(authService.loginWithGoogle).not.toHaveBeenCalled();
  });
});
