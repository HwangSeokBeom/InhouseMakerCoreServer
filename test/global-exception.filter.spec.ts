import { ArgumentsHost, HttpStatus } from '@nestjs/common';

import { AppErrorCode, AppException } from '../src/common/app.exception';
import { GlobalExceptionFilter } from '../src/common/filters/global-exception.filter';

describe('GlobalExceptionFilter', () => {
  const createHost = (requestOverrides: Record<string, unknown> = {}) => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    const request = {
      method: 'GET',
      url: '/matches/match-ui-test',
      originalUrl: '/matches/match-ui-test',
      route: { path: '/matches/:matchId' },
      baseUrl: '',
      headers: {},
      user: { userId: 'viewer1' },
      ...requestOverrides,
    };

    const host = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as ArgumentsHost;

    return { host, request, response };
  };

  it('emits HomeRequestDebug logs for home detail 404 responses with diagnostics', () => {
    const filter = new GlobalExceptionFilter();
    const { host, response } = createHost();
    const homeDebugSpy = jest
      .spyOn(filter['homeRequestDebugLogger'], 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn(filter['errorDebugLogger'], 'warn')
      .mockImplementation(() => undefined);

    filter.catch(
      new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.MATCH_NOT_FOUND,
        'Match not found.',
        {
          matchId: 'match-ui-test',
          probableCause: 'stale_client_reference',
          fixtureHint: 'removed_fixture',
          reason: 'MATCH_NOT_FOUND',
        },
      ),
      host,
    );

    expect(homeDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('[HomeRequestDebug]'),
    );
    expect(homeDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('requesterUserId=viewer1'),
    );
    expect(homeDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('path=/matches/match-ui-test'),
    );
    expect(homeDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('outcome=not_found'),
    );
    expect(homeDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('probableCause=stale_client_reference'),
    );
    expect(homeDebugSpy).toHaveBeenCalledWith(
      expect.stringContaining('fixtureHint=removed_fixture'),
    );
    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it('skips HomeRequestDebug logs for unrelated routes', () => {
    const filter = new GlobalExceptionFilter();
    const { host } = createHost({
      url: '/users/user1',
      originalUrl: '/users/user1',
      route: { path: '/users/:userId' },
    });
    const homeDebugSpy = jest
      .spyOn(filter['homeRequestDebugLogger'], 'warn')
      .mockImplementation(() => undefined);
    jest
      .spyOn(filter['errorDebugLogger'], 'warn')
      .mockImplementation(() => undefined);

    filter.catch(
      new AppException(
        HttpStatus.NOT_FOUND,
        AppErrorCode.NOT_FOUND,
        'Not found.',
        {
          probableCause: 'stale_client_reference',
        },
      ),
      host,
    );

    expect(homeDebugSpy).not.toHaveBeenCalled();
  });
});
