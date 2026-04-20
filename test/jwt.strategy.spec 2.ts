import { UserStatus } from '@prisma/client';

import { AuthErrorCode } from '../src/auth/auth-error-code';
import { JwtStrategy } from '../src/auth/jwt.strategy';

describe('JwtStrategy', () => {
  const configService = {
    getOrThrow: jest.fn(() => 'access-secret'),
  };
  const prismaService = {
    user: {
      findUnique: jest.fn(),
    },
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns authenticated user data for active accounts', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      status: UserStatus.ACTIVE,
    });
    const strategy = new JwtStrategy(configService as any, prismaService);

    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'stale@example.com',
        type: 'access',
      }),
    ).resolves.toEqual({
      userId: 'user-1',
      email: 'user@example.com',
    });
  });

  it('blocks withdrawn accounts from protected APIs even if the access token is still present', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      status: UserStatus.WITHDRAWN,
    });
    const strategy = new JwtStrategy(configService as any, prismaService);

    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'user@example.com',
        type: 'access',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: AuthErrorCode.ACCOUNT_UNAVAILABLE,
      }),
    });
  });
});
