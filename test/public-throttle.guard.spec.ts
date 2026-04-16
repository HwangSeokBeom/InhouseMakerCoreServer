import { ExecutionContext } from '@nestjs/common';

import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';
import { PublicThrottleGuard } from '../src/common/guards/public-throttle.guard';

describe('PublicThrottleGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  };

  const createContext = () => {
    const response = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      method: 'POST',
      path: '/matches/balance/preview',
      route: { path: 'balance/preview' },
      ip: '127.0.0.1',
      headers: {},
    };

    return {
      request,
      response,
      context: ({
        getHandler: () => 'handler',
        getClass: () => 'class',
        switchToHttp: () => {
          return {
            getRequest: () => request as any,
            getResponse: () => response,
          };
        },
      }) as unknown as ExecutionContext,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
    PublicThrottleGuard.resetStore();
    reflector.getAllAndOverride.mockReturnValue({
      scope: 'matches-balance-preview',
      limit: 1,
      windowSeconds: 60,
    });
  });

  it('returns RATE_LIMITED shape after the configured guest quota is exceeded', () => {
    const guard = new PublicThrottleGuard(reflector as any);
    const firstContext = createContext();

    expect(guard.canActivate(firstContext.context)).toBe(true);

    const secondContext = createContext();
    const filter = new GlobalExceptionFilter();
    const { response, request } = secondContext;

    try {
      guard.canActivate(secondContext.context);
      throw new Error('Expected RATE_LIMITED exception');
    } catch (error) {
      filter.catch(
        error,
        {
          switchToHttp: () => ({
            getResponse: () => response,
            getRequest: () => request,
          }),
        } as any,
      );
    }

    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: 'RATE_LIMITED',
        provider: null,
        statusCode: 429,
        details: expect.objectContaining({
          scope: 'matches-balance-preview',
          limit: 1,
          windowSeconds: 60,
        }),
      }),
    );
  });
});
