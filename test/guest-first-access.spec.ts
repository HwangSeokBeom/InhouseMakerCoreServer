import { BadRequestException, ExecutionContext, ForbiddenException } from '@nestjs/common';

import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PublicThrottleGuard } from '../src/common/guards/public-throttle.guard';
import { ReferenceController } from '../src/reference/reference.controller';

describe('Guest-first access contracts', () => {
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

  it('normalizes generic forbidden responses to FORBIDDEN_FEATURE shape', () => {
    const payload = renderException(
      new ForbiddenException('Only members can access this resource.'),
      '/groups/private-group',
    );

    expect(payload).toMatchObject({
      success: false,
      code: 'FORBIDDEN_FEATURE',
      provider: null,
      statusCode: 403,
      details: {},
    });
  });

  it('normalizes generic bad request responses to INVALID_PAYLOAD shape', () => {
    const payload = renderException(
      new BadRequestException('Payload is invalid.'),
      '/auth/signup/email',
    );

    expect(payload).toMatchObject({
      success: false,
      code: 'INVALID_PAYLOAD',
      provider: null,
      statusCode: 400,
    });
  });
});
