import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';

import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { AppErrorCode } from '../src/common/app.exception';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PublicThrottleGuard } from '../src/common/guards/public-throttle.guard';
import { ReferenceController } from '../src/reference/reference.controller';
import { RecruitingQueryDto } from '../src/recruiting/dto/recruiting.dto';

describe('Guest-first access contracts', () => {
  const createValidationPipe = () =>
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
    });

  const renderException = (exception: unknown, path: string) => {
    const filter = new GlobalExceptionFilter();
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
    };
    const request = {
      method: 'GET',
      url: path,
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    };

    filter.catch(exception, host as any);

    return response.json.mock.calls[0][0] as Record<string, unknown>;
  };

  beforeEach(() => {
    PublicThrottleGuard.resetStore();
  });

  it('allows guest clients to consume public reference data', () => {
    const controller = new ReferenceController();

    expect(controller.getPositions()).toEqual({
      items: ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'],
    });
    expect(controller.getTiers()).toEqual({
      items: [
        'IRON',
        'BRONZE',
        'SILVER',
        'GOLD',
        'PLATINUM',
        'EMERALD',
        'DIAMOND',
        'MASTER',
        'GRANDMASTER',
        'CHALLENGER',
      ],
    });
  });

  it('returns AUTH_REQUIRED response shape for guest access to authenticated APIs', () => {
    const guard = new JwtAuthGuard();

    try {
      guard.handleRequest(null, null, null, {} as ExecutionContext);
      throw new Error('Expected AUTH_REQUIRED exception');
    } catch (error) {
      const payload = renderException(error, '/users/me');

      expect(payload).toMatchObject({
        success: false,
        code: 'AUTH_REQUIRED',
        provider: null,
        statusCode: 401,
        details: {
          reason: 'sign_in_required_for_cloud_features',
          supportedProviders: ['email', 'apple', 'google'],
        },
        path: '/users/me',
      });
    }
  });

  it('normalizes expired or invalid access tokens to AUTH_REQUIRED', () => {
    const guard = new JwtAuthGuard();

    try {
      guard.handleRequest(null, null, new Error('jwt expired'), {} as ExecutionContext);
      throw new Error('Expected AUTH_REQUIRED exception');
    } catch (error) {
      const payload = renderException(error, '/notifications');
      expect(payload).toMatchObject({
        code: 'AUTH_REQUIRED',
        provider: null,
        statusCode: 401,
        details: {
          reason: 'sign_in_required_for_cloud_features',
        },
      });
    }
  });

  it('normalizes generic forbidden responses to FORBIDDEN shape', () => {
    const payload = renderException(
      new ForbiddenException('Only members can access this resource.'),
      '/groups/private-group',
    );

    expect(payload).toMatchObject({
      success: false,
      code: 'FORBIDDEN',
      provider: null,
      statusCode: 403,
      details: {},
    });
  });

  it('requires authentication for recruiting detail access by guests', () => {
    const guard = new JwtAuthGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          originalUrl: '/recruiting-posts/post-1',
          params: {
            postId: 'post-1',
          },
        }),
      }),
    };

    try {
      guard.handleRequest(null, null, null, context as unknown as ExecutionContext);
      throw new Error('Expected AUTH_REQUIRED exception');
    } catch (error) {
      const payload = renderException(error, '/recruiting-posts/post-1');

      expect(payload).toMatchObject({
        success: false,
        code: 'AUTH_REQUIRED',
        provider: null,
        statusCode: 401,
        path: '/recruiting-posts/post-1',
      });
    }
  });

  it('normalizes generic not found responses to NOT_FOUND shape', () => {
    const payload = renderException(
      new NotFoundException('Recruiting post not found.'),
      '/recruiting-posts/missing-post',
    );

    expect(payload).toMatchObject({
      success: false,
      code: 'NOT_FOUND',
      provider: null,
      statusCode: 404,
      details: {},
    });
  });

  it('preserves details.reason for structured not found responses', () => {
    const payload = renderException(
      new NotFoundException({
        message: 'The group no longer exists or is unavailable.',
        details: {
          reason: 'GROUP_ARCHIVED',
        },
      }),
      '/groups/group-1',
    );

    expect(payload).toMatchObject({
      success: false,
      code: 'NOT_FOUND',
      provider: null,
      statusCode: 404,
      message: 'The group no longer exists or is unavailable.',
      details: {
        reason: 'GROUP_ARCHIVED',
      },
    });
  });

  it('normalizes generic bad request responses to VALIDATION_ERROR shape', () => {
    const payload = renderException(
      new BadRequestException('Payload is invalid.'),
      '/auth/signup/email',
    );

    expect(payload).toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
      provider: null,
      statusCode: 400,
    });
  });

  it('parses includeUnscheduled query values as booleans', async () => {
    const pipe = createValidationPipe();

    const result = await pipe.transform(
      { includeUnscheduled: 'true' },
      {
        type: 'query',
        metatype: RecruitingQueryDto,
      } as any,
    );

    expect(result).toMatchObject({
      includeUnscheduled: true,
    });
  });

  it('keeps includeUnscheduled validation errors parseable for clients', async () => {
    const pipe = createValidationPipe();

    try {
      await pipe.transform(
        { includeUnscheduled: 'maybe' },
        {
          type: 'query',
          metatype: RecruitingQueryDto,
        } as any,
      );
      throw new Error('Expected VALIDATION_ERROR validation error');
    } catch (error) {
      const payload = renderException(error, '/recruiting-posts?includeUnscheduled=maybe');

      expect(payload).toMatchObject({
        success: false,
        code: 'VALIDATION_ERROR',
        provider: null,
        statusCode: 400,
        details: {
          validationErrors: expect.arrayContaining([
            {
              field: 'includeUnscheduled',
              message: 'includeUnscheduled must be a boolean value',
            },
          ]),
        },
      });
    }
  });
});
