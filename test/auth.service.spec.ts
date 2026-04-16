import { HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider, UserStatus } from '@prisma/client';
import { hash } from 'bcryptjs';

import { AuthErrorCode } from '../src/auth/auth-error-code';
import { AuthService } from '../src/auth/auth.service';

type UserRow = {
  id: string;
  email: string;
  nickname: string;
  status: UserStatus;
  refreshTokenHash: string | null;
};

type AuthIdentityRow = {
  id: string;
  userId: string;
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
  passwordHash: string | null;
  linkedAt: Date;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

class InMemoryAuthPrisma {
  private nextUserId = 1;
  private nextIdentityId = 1;

  readonly state = {
    users: [] as UserRow[],
    authIdentities: [] as AuthIdentityRow[],
  };

  readonly authIdentity = {
    findMany: jest.fn(async (args?: any) => {
      const email = args?.where?.email ?? null;
      return this.state.authIdentities
        .filter((identity) => (email ? identity.email === email : true))
        .map((identity) => this.pick(identity, args?.select));
    }),
    findUnique: jest.fn(async (args: any) => {
      const where = args?.where ?? {};
      let identity: AuthIdentityRow | undefined;
      if (where.provider_providerUserId) {
        identity = this.state.authIdentities.find(
          (item) =>
            item.provider === where.provider_providerUserId.provider &&
            item.providerUserId === where.provider_providerUserId.providerUserId,
        );
      } else if (where.id) {
        identity = this.state.authIdentities.find((item) => item.id === where.id);
      }

      if (!identity) {
        return null;
      }

      if (args?.include?.user?.select) {
        const user = this.state.users.find((item) => item.id === identity.userId)!;
        return {
          ...identity,
          user: this.pick(user, args.include.user.select),
        };
      }

      return this.pick(identity, args?.select);
    }),
    create: jest.fn(async (args: any) => {
      const now = new Date();
      const row: AuthIdentityRow = {
        id: `ai_${this.nextIdentityId++}`,
        userId: args.data.userId,
        provider: args.data.provider,
        providerUserId: args.data.providerUserId,
        email: args.data.email ?? null,
        passwordHash: args.data.passwordHash ?? null,
        linkedAt: now,
        lastLoginAt: args.data.lastLoginAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.state.authIdentities.push(row);
      return this.pick(row, args?.select);
    }),
    update: jest.fn(async (args: any) => {
      const identity = this.state.authIdentities.find((item) => item.id === args.where.id);
      if (!identity) {
        throw new Error('Identity not found');
      }
      Object.assign(identity, args.data, { updatedAt: new Date() });
      return this.pick(identity, args?.select);
    }),
    findFirst: jest.fn(async (args?: any) => {
      const userId = args?.where?.userId;
      const identities = this.state.authIdentities
        .filter((identity) => (userId ? identity.userId === userId : true))
        .sort((left, right) => {
          const leftLastLogin = left.lastLoginAt?.getTime() ?? 0;
          const rightLastLogin = right.lastLoginAt?.getTime() ?? 0;
          if (leftLastLogin !== rightLastLogin) {
            return rightLastLogin - leftLastLogin;
          }
          return right.linkedAt.getTime() - left.linkedAt.getTime();
        });

      const identity = identities[0];
      if (!identity) {
        return null;
      }

      return this.pick(identity, args?.select);
    }),
  };

  readonly user = {
    findUnique: jest.fn(async (args: any) => {
      const where = args?.where ?? {};
      const user = this.state.users.find((item) => {
        if (where.id) {
          return item.id === where.id;
        }
        if (where.email) {
          return item.email === where.email;
        }
        if (where.nickname) {
          return item.nickname === where.nickname;
        }
        return false;
      });

      if (!user) {
        return null;
      }

      return this.pick(user, args?.select);
    }),
    create: jest.fn(async (args: any) => {
      const row: UserRow = {
        id: `u_${this.nextUserId++}`,
        email: args.data.email,
        nickname: args.data.nickname,
        status: args.data.status,
        refreshTokenHash: null,
      };
      this.state.users.push(row);
      return this.pick(row, args?.select);
    }),
    update: jest.fn(async (args: any) => {
      const user = this.state.users.find((item) => item.id === args.where.id);
      if (!user) {
        throw new Error('User not found');
      }
      Object.assign(user, args.data);
      return this.pick(user, args?.select);
    }),
  };

  readonly $transaction = jest.fn(async (arg: any) => {
    if (typeof arg === 'function') {
      return arg(this);
    }
    return Promise.all(arg);
  });

  seedSocialUser(
    provider: AuthProvider,
    providerUserId: string,
    email: string | null,
    nickname = `${provider.toLowerCase()}-user`,
  ): UserRow {
    const user = this.seedUser(
      email ?? `${provider.toLowerCase()}-${providerUserId}@no-email.auth.local`,
      nickname,
    );
    this.linkIdentity(user.id, provider, providerUserId, email);
    return user;
  }

  async seedEmailUser(
    email: string,
    password: string,
    nickname = 'email-user',
  ): Promise<UserRow> {
    const user = this.seedUser(email, nickname);
    this.linkIdentity(
      user.id,
      AuthProvider.EMAIL,
      email,
      email,
      await hash(password, 10),
    );
    return user;
  }

  linkIdentity(
    userId: string,
    provider: AuthProvider,
    providerUserId: string,
    email: string | null,
    passwordHash: string | null = null,
  ): void {
    const now = new Date();
    this.state.authIdentities.push({
      id: `ai_${this.nextIdentityId++}`,
      userId,
      provider,
      providerUserId,
      email,
      passwordHash,
      linkedAt: now,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  private seedUser(email: string, nickname: string): UserRow {
    const user: UserRow = {
      id: `u_${this.nextUserId++}`,
      email,
      nickname,
      status: UserStatus.ACTIVE,
      refreshTokenHash: null,
    };
    this.state.users.push(user);
    return user;
  }

  private pick<T extends Record<string, unknown>>(value: T, select?: Record<string, boolean>) {
    if (!select) {
      return { ...value };
    }

    return Object.fromEntries(
      Object.entries(select)
        .filter(([, enabled]) => enabled)
        .map(([key]) => [key, value[key as keyof T]]),
    );
  }
}

const expectAuthError = async (promise: Promise<unknown>, errorCode: AuthErrorCode) => {
  try {
    await promise;
    throw new Error(`Expected ${errorCode}`);
  } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    const exception = error as HttpException;
    const response = exception.getResponse() as Record<string, unknown>;
    expect(response.code).toBe(errorCode);
    return {
      response,
      statusCode: exception.getStatus(),
    };
  }
};

describe('AuthService', () => {
  const jwtService = new JwtService();
  const config = {
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
    JWT_ACCESS_EXPIRES_IN: '1h',
    JWT_REFRESH_EXPIRES_IN: '30d',
  } as const;

  const createService = () => {
    const prisma = new InMemoryAuthPrisma();
    const appleVerifier = {
      verifyIdentityToken: jest.fn(),
    };
    const googleVerifier = {
      verifyIdentityToken: jest.fn(),
    };
    const configService = {
      get: jest.fn((key: string) => config[key as keyof typeof config]),
      getOrThrow: jest.fn((key: string) => {
        const value = config[key as keyof typeof config];
        if (value === undefined) {
          throw new Error(`Missing config ${key}`);
        }
        return value;
      }),
    };

    return {
      prisma,
      appleVerifier,
      googleVerifier,
      service: new AuthService(
        prisma as any,
        jwtService,
        configService as any,
        appleVerifier as any,
        googleVerifier as any,
      ),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a new email user and identity on signup without requiring email verification', async () => {
    const { service, prisma } = createService();

    const result = await service.signupWithEmail({
      email: 'new@example.com',
      password: 'Password1',
      nickname: 'Newbie',
      agreedToTerms: true,
      agreedToPrivacy: true,
      agreedToMarketing: false,
    });
    const accessPayload = await jwtService.verifyAsync<{ sub: string; email: string }>(
      result.accessToken,
      { secret: config.JWT_ACCESS_SECRET },
    );

    expect(result.user).toMatchObject({
      email: 'new@example.com',
      nickname: 'Newbie',
      provider: 'email',
    });
    expect(accessPayload.sub).toBe(result.user.id);
    expect(prisma.state.authIdentities).toHaveLength(1);
    expect(prisma.state.authIdentities[0]).toMatchObject({
      provider: AuthProvider.EMAIL,
      providerUserId: 'new@example.com',
      email: 'new@example.com',
    });
    expect(prisma.state.authIdentities[0].passwordHash).not.toBe('Password1');
  });

  it('fails signup when the email format is invalid', async () => {
    const { service } = createService();

    const { response, statusCode } = await expectAuthError(
      service.signupWithEmail({
        email: 'not-an-email',
        password: 'Password1',
        nickname: 'Newbie',
        agreedToTerms: true,
        agreedToPrivacy: true,
        agreedToMarketing: false,
      }),
      AuthErrorCode.INVALID_EMAIL_FORMAT,
    );

    expect(statusCode).toBe(400);
    expect(response).toMatchObject({
      provider: 'email',
      details: {
        provider: 'email',
      },
    });
  });

  it('fails signup when required terms are not agreed', async () => {
    const { service } = createService();

    const { response, statusCode } = await expectAuthError(
      service.signupWithEmail({
        email: 'new@example.com',
        password: 'Password1',
        nickname: 'Newbie',
        agreedToTerms: false,
        agreedToPrivacy: true,
        agreedToMarketing: false,
      }),
      AuthErrorCode.REQUIRED_TERMS_NOT_AGREED,
    );

    expect(statusCode).toBe(400);
    expect(response).toMatchObject({
      provider: 'email',
      details: {
        provider: 'email',
        required: ['agreedToTerms', 'agreedToPrivacy'],
      },
    });
  });

  it('fails signup when the password is weak', async () => {
    const { service } = createService();

    const { response, statusCode } = await expectAuthError(
      service.signupWithEmail({
        email: 'new@example.com',
        password: 'weak',
        nickname: 'Newbie',
        agreedToTerms: true,
        agreedToPrivacy: true,
        agreedToMarketing: false,
      }),
      AuthErrorCode.WEAK_PASSWORD,
    );

    expect(statusCode).toBe(400);
    expect(response).toMatchObject({
      provider: 'email',
      details: {
        provider: 'email',
      },
    });
  });

  it('fails signup when an email account already exists', async () => {
    const { service, prisma } = createService();
    await prisma.seedEmailUser('taken@example.com', 'Password1', 'TakenNick');

    const { response, statusCode } = await expectAuthError(
      service.signupWithEmail({
        email: 'taken@example.com',
        password: 'Password1',
        nickname: 'AnotherNick',
        agreedToTerms: true,
        agreedToPrivacy: true,
        agreedToMarketing: false,
      }),
      AuthErrorCode.EMAIL_ALREADY_IN_USE,
    );

    expect(statusCode).toBe(409);
    expect(response).toMatchObject({
      provider: 'email',
      details: {
        email: 'taken@example.com',
        provider: 'email',
        availableProviders: ['email'],
      },
    });
  });

  it('fails signup when nickname already exists', async () => {
    const { service, prisma } = createService();
    prisma.seedSocialUser(AuthProvider.APPLE, 'apple-sub-1', 'apple@example.com', 'DupNick');

    const { response, statusCode } = await expectAuthError(
      service.signupWithEmail({
        email: 'fresh@example.com',
        password: 'Password1',
        nickname: 'DupNick',
        agreedToTerms: true,
        agreedToPrivacy: true,
        agreedToMarketing: false,
      }),
      AuthErrorCode.NICKNAME_ALREADY_IN_USE,
    );

    expect(statusCode).toBe(409);
    expect(response).toMatchObject({
      provider: 'email',
      details: {
        nickname: 'DupNick',
        provider: 'email',
      },
    });
  });

  it('returns PROVIDER_CONFLICT when email signup targets a social-only account', async () => {
    const { service, prisma } = createService();
    prisma.seedSocialUser(AuthProvider.APPLE, 'apple-sub-1', 'shared@example.com');

    const { response } = await expectAuthError(
      service.signupWithEmail({
        email: 'shared@example.com',
        password: 'Password1',
        nickname: 'FreshNick',
        agreedToTerms: true,
        agreedToPrivacy: true,
        agreedToMarketing: false,
      }),
      AuthErrorCode.PROVIDER_CONFLICT,
    );

    expect(response).toMatchObject({
      provider: 'email',
      details: {
        email: 'shared@example.com',
        provider: 'email',
        availableProviders: ['apple'],
        supportedProviders: ['email', 'apple', 'google'],
      },
    });
  });

  it('logs in with an existing email identity', async () => {
    const { service, prisma } = createService();
    const existingUser = await prisma.seedEmailUser(
      'member@example.com',
      'Password1',
      'MemberOne',
    );

    const result = await service.loginWithEmail({
      email: 'member@example.com',
      password: 'Password1',
    });

    expect(result.user.id).toBe(existingUser.id);
    expect(result.user.provider).toBe('email');
    expect(prisma.state.users).toHaveLength(1);
  });

  it('returns ACCOUNT_NOT_FOUND for an unknown email login', async () => {
    const { service } = createService();

    const { response, statusCode } = await expectAuthError(
      service.loginWithEmail({
        email: 'missing@example.com',
        password: 'Password1',
      }),
      AuthErrorCode.ACCOUNT_NOT_FOUND,
    );

    expect(statusCode).toBe(404);
    expect(response).toMatchObject({
      provider: 'email',
      details: {
        email: 'missing@example.com',
        provider: 'email',
      },
    });
  });

  it('returns INVALID_CREDENTIALS when the email password is wrong', async () => {
    const { service, prisma } = createService();
    await prisma.seedEmailUser('member@example.com', 'Password1', 'MemberOne');

    const { response, statusCode } = await expectAuthError(
      service.loginWithEmail({
        email: 'member@example.com',
        password: 'WrongPassword1',
      }),
      AuthErrorCode.INVALID_CREDENTIALS,
    );

    expect(statusCode).toBe(401);
    expect(response).toMatchObject({
      provider: 'email',
      details: {
        email: 'member@example.com',
        provider: 'email',
      },
    });
  });

  it('returns PROVIDER_CONFLICT when email login targets a social-only account', async () => {
    const { service, prisma } = createService();
    prisma.seedSocialUser(AuthProvider.GOOGLE, 'google-sub-1', 'shared@example.com');

    const { response, statusCode } = await expectAuthError(
      service.loginWithEmail({
        email: 'shared@example.com',
        password: 'Password1',
      }),
      AuthErrorCode.PROVIDER_CONFLICT,
    );

    expect(statusCode).toBe(409);
    expect(response).toMatchObject({
      provider: 'email',
      details: {
        email: 'shared@example.com',
        provider: 'email',
        availableProviders: ['google'],
      },
    });
  });

  it('includes email in availableProviders when social login conflicts with an email-linked account', async () => {
    const { service, googleVerifier, prisma } = createService();
    const user = await prisma.seedEmailUser('shared@example.com', 'Password1', 'SharedUser');
    prisma.linkIdentity(
      user.id,
      AuthProvider.APPLE,
      'apple-sub-1',
      'shared@example.com',
    );
    googleVerifier.verifyIdentityToken.mockResolvedValue({
      sub: 'google-sub-1',
      email: 'shared@example.com',
      emailVerified: true,
    });

    const { response } = await expectAuthError(
      service.loginWithGoogle({ identityToken: 'google-token' }),
      AuthErrorCode.PROVIDER_CONFLICT,
    );

    expect(response).toMatchObject({
      provider: 'google',
      details: {
        email: 'shared@example.com',
        provider: 'google',
        availableProviders: ['email', 'apple'],
      },
    });
  });

  it('does not return legacy disabled codes for active email login routes', async () => {
    const { service } = createService();

    const { response } = await expectAuthError(
      service.loginWithEmail({
        email: 'missing@example.com',
        password: 'Password1',
      }),
      AuthErrorCode.ACCOUNT_NOT_FOUND,
    );

    expect(response.code).not.toBe(AuthErrorCode.EMAIL_AUTH_DISABLED);
    expect(response.code).not.toBe(AuthErrorCode.PASSWORD_AUTH_DISABLED);
  });

  it('creates a new user and apple identity on first Apple login', async () => {
    const { service, appleVerifier, prisma } = createService();
    appleVerifier.verifyIdentityToken.mockResolvedValue({
      sub: 'apple-sub-1',
      email: 'apple@example.com',
      emailVerified: true,
    });

    const result = await service.loginWithApple({ identityToken: 'apple-token' });

    expect(result.user.email).toBe('apple@example.com');
    expect(result.user.provider).toBe('apple');
    expect(prisma.state.authIdentities).toHaveLength(1);
    expect(prisma.state.authIdentities[0].provider).toBe(AuthProvider.APPLE);
  });

  it('logs in with an existing Google identity', async () => {
    const { service, googleVerifier, prisma } = createService();
    const existingUser = prisma.seedSocialUser(
      AuthProvider.GOOGLE,
      'google-sub-1',
      'google@example.com',
    );
    googleVerifier.verifyIdentityToken.mockResolvedValue({
      sub: 'google-sub-1',
      email: 'google@example.com',
      emailVerified: true,
    });

    const result = await service.loginWithGoogle({ identityToken: 'google-token' });

    expect(result.user.id).toBe(existingUser.id);
    expect(result.user.provider).toBe('google');
    expect(prisma.state.users).toHaveLength(1);
  });

  it('returns PROVIDER_CONFLICT when the same provider email maps to another sub', async () => {
    const { service, googleVerifier, prisma } = createService();
    prisma.seedSocialUser(AuthProvider.GOOGLE, 'google-sub-1', 'google@example.com');
    googleVerifier.verifyIdentityToken.mockResolvedValue({
      sub: 'google-sub-2',
      email: 'google@example.com',
      emailVerified: true,
    });

    const { response } = await expectAuthError(
      service.loginWithGoogle({ identityToken: 'google-token' }),
      AuthErrorCode.PROVIDER_CONFLICT,
    );

    expect(response).toMatchObject({
      provider: 'google',
      details: {
        email: 'google@example.com',
        provider: 'google',
        availableProviders: ['google'],
      },
    });
  });

  it('maps invalid Apple and Google tokens to SOCIAL_TOKEN_INVALID', async () => {
    const { service, appleVerifier, googleVerifier } = createService();
    appleVerifier.verifyIdentityToken.mockRejectedValue(
      new UnauthorizedException('Apple identity token expired.'),
    );
    googleVerifier.verifyIdentityToken.mockRejectedValue(
      new UnauthorizedException('Google identity token expired.'),
    );

    const { response: appleResponse } = await expectAuthError(
      service.loginWithApple({ identityToken: 'bad-apple-token' }),
      AuthErrorCode.SOCIAL_TOKEN_INVALID,
    );
    const { response: googleResponse } = await expectAuthError(
      service.loginWithGoogle({ identityToken: 'bad-google-token' }),
      AuthErrorCode.SOCIAL_TOKEN_INVALID,
    );

    expect(appleResponse).toMatchObject({
      provider: 'apple',
      details: {
        provider: 'apple',
      },
    });
    expect(googleResponse).toMatchObject({
      provider: 'google',
      details: {
        provider: 'google',
      },
    });
  });

  it('refreshes tokens with rotation and invalidates them on logout', async () => {
    const { service, appleVerifier, prisma } = createService();
    appleVerifier.verifyIdentityToken.mockResolvedValue({
      sub: 'apple-sub-1',
      email: 'apple@example.com',
      emailVerified: true,
    });

    const signedIn = await service.loginWithApple({ identityToken: 'apple-token' });
    const refreshed = await service.refresh(signedIn.refreshToken);

    expect(refreshed.refreshToken).not.toBe(signedIn.refreshToken);
    expect(refreshed.user.provider).toBe('apple');

    await service.logout(refreshed.user.id);

    await expectAuthError(
      service.refresh(refreshed.refreshToken),
      AuthErrorCode.INVALID_CREDENTIALS,
    );
    expect(prisma.state.users[0].refreshTokenHash).toBeNull();
  });

  it('maps malformed refresh tokens to INVALID_CREDENTIALS with a stable shape', async () => {
    const { service } = createService();

    const { response, statusCode } = await expectAuthError(
      service.refresh('not-a-jwt'),
      AuthErrorCode.INVALID_CREDENTIALS,
    );

    expect(statusCode).toBe(401);
    expect(response).toMatchObject({
      provider: null,
      message: 'Refresh token is invalid or expired.',
    });
  });
});
