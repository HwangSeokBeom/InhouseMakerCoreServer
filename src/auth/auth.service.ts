import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthProvider, Prisma, User, UserStatus } from '@prisma/client';
import { compare, hash } from 'bcryptjs';
import { isEmail } from 'class-validator';
import { randomUUID } from 'node:crypto';

import { resolveNodeEnv } from '../config/runtime-env';
import { PrismaService } from '../prisma/prisma.service';
import { AppleIdentityTokenVerifierService } from './apple-identity-token-verifier.service';
import { AuthErrorCode } from './auth-error-code';
import { AuthException } from './auth.exception';
import { GoogleIdentityTokenVerifierService } from './google-identity-token-verifier.service';
import {
  AppleLoginDto,
  AuthTokensResponseDto,
  AuthUserResponseDto,
  EmailLoginDto,
  EmailSignupDto,
  GoogleLoginDto,
  SUPPORTED_AUTH_PROVIDERS,
  normalizeAuthProviders,
  toAuthProviderResponse,
} from './dto/auth.dto';

interface TokenPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
  jti?: string;
}

interface SocialIdentityClaims {
  provider: AuthProvider;
  providerUserId: string;
  email: string | null;
}

interface IssueTokensOptions {
  identityId?: string;
  provider?: AuthProvider | null;
}

type UserRecord = Pick<User, 'id' | 'email' | 'nickname' | 'status'>;

const PASSWORD_SALT_ROUNDS = 10;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_STRENGTH_PATTERN = /^(?=.*[A-Za-z])(?=.*\d).+$/;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly userSelect = {
    id: true,
    email: true,
    nickname: true,
    status: true,
  } satisfies Prisma.UserSelect;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly appleIdentityTokenVerifierService: AppleIdentityTokenVerifierService,
    private readonly googleIdentityTokenVerifierService: GoogleIdentityTokenVerifierService,
  ) {}

  async rejectEmailAuthDisabled(): Promise<never> {
    throw new AuthException(HttpStatus.GONE, AuthErrorCode.EMAIL_AUTH_DISABLED, {
      message: 'Legacy email verification flow is disabled.',
      provider: AuthProvider.EMAIL,
      details: {
        provider: AuthProvider.EMAIL,
        supportedProviders: SUPPORTED_AUTH_PROVIDERS,
      },
    });
  }

  async rejectPasswordAuthDisabled(): Promise<never> {
    throw new AuthException(HttpStatus.GONE, AuthErrorCode.PASSWORD_AUTH_DISABLED, {
      message: 'Legacy password auth route is disabled.',
      provider: AuthProvider.EMAIL,
      details: {
        provider: AuthProvider.EMAIL,
        supportedProviders: SUPPORTED_AUTH_PROVIDERS,
      },
    });
  }

  async signupWithEmail(dto: EmailSignupDto): Promise<AuthTokensResponseDto> {
    const email = this.normalizeEmail(dto.email);
    const password = dto.password ?? '';
    const nickname = this.normalizeNickname(dto.nickname);

    this.logSignupDebug('request_received', {
      email,
      nickname,
      agreedToTerms: dto.agreedToTerms,
      agreedToPrivacy: dto.agreedToPrivacy,
      agreedToMarketing: dto.agreedToMarketing,
    });

    try {
      this.assertValidEmail(email);
      this.assertStrongPassword(password);
      this.assertRequiredTerms(dto);

      await this.assertEmailSignupAvailable(email);
      await this.assertNicknameAvailable(nickname);

      const passwordHash = await hash(password, PASSWORD_SALT_ROUNDS);
      const now = new Date();
      const created = await this.prismaService.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            nickname,
            status: UserStatus.ACTIVE,
            termsAgreedAt: now,
            privacyAgreedAt: now,
            marketingOptInAt: dto.agreedToMarketing ? now : null,
            powerProfile: {
              create: {
                version: 'v1',
              },
            },
          },
          select: this.userSelect,
        });

        const identity = await tx.authIdentity.create({
          data: {
            userId: user.id,
            provider: AuthProvider.EMAIL,
            providerUserId: email,
            email,
            passwordHash,
            lastLoginAt: now,
          },
          select: { id: true },
        });

        return {
          user,
          identityId: identity.id,
        };
      });

      const tokens = await this.issueTokens(created.user, {
        identityId: created.identityId,
        provider: AuthProvider.EMAIL,
      });
      this.logSignupDebug('signup_succeeded', {
        email,
        userId: created.user.id,
        code: 'OK',
      });
      return tokens;
    } catch (error) {
      this.logSignupDebug('signup_failed', {
        email,
        nickname,
        code: this.resolveErrorCode(error),
        statusCode: this.resolveStatusCode(error),
        message: this.resolveErrorMessage(error),
      });
      await this.rethrowEmailSignupConflict(error, email, nickname);
      throw error;
    }
  }

  async loginWithEmail(dto: EmailLoginDto): Promise<AuthTokensResponseDto> {
    const email = this.normalizeEmail(dto.email);
    const password = dto.password ?? '';

    this.assertValidEmail(email);

    const user = await this.prismaService.user.findUnique({
      where: { email },
      select: this.userSelect,
    });

    if (!user) {
      throw new AuthException(HttpStatus.NOT_FOUND, AuthErrorCode.ACCOUNT_NOT_FOUND, {
        provider: AuthProvider.EMAIL,
        details: {
          email,
          provider: AuthProvider.EMAIL,
          supportedProviders: SUPPORTED_AUTH_PROVIDERS,
        },
      });
    }
    this.assertUserCanAuthenticate(user, AuthProvider.EMAIL);

    const identity = await this.prismaService.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: AuthProvider.EMAIL,
          providerUserId: email,
        },
      },
      select: {
        id: true,
        passwordHash: true,
      },
    });

    if (!identity) {
      const availableProviders = await this.findAvailableProvidersByEmail(email);
      if (availableProviders.length > 0) {
        throw this.buildProviderConflictException(
          AuthProvider.EMAIL,
          email,
          availableProviders,
        );
      }

      throw new AuthException(HttpStatus.NOT_FOUND, AuthErrorCode.ACCOUNT_NOT_FOUND, {
        provider: AuthProvider.EMAIL,
        details: {
          email,
          provider: AuthProvider.EMAIL,
          supportedProviders: SUPPORTED_AUTH_PROVIDERS,
        },
      });
    }

    // TODO: Promote this to a persistent per-account limiter before production scale-up.
    if (!identity.passwordHash) {
      throw new AuthException(HttpStatus.UNAUTHORIZED, AuthErrorCode.INVALID_CREDENTIALS, {
        provider: AuthProvider.EMAIL,
        message: 'Password login is not available for this account.',
        details: {
          email,
          provider: AuthProvider.EMAIL,
          supportedProviders: SUPPORTED_AUTH_PROVIDERS,
        },
      });
    }

    const isValid = await compare(password, identity.passwordHash);
    if (!isValid) {
      throw new AuthException(HttpStatus.UNAUTHORIZED, AuthErrorCode.INVALID_CREDENTIALS, {
        provider: AuthProvider.EMAIL,
        details: {
          email,
          provider: AuthProvider.EMAIL,
          supportedProviders: SUPPORTED_AUTH_PROVIDERS,
        },
      });
    }

    return this.issueTokens(user, {
      identityId: identity.id,
      provider: AuthProvider.EMAIL,
    });
  }

  async loginWithApple(dto: AppleLoginDto): Promise<AuthTokensResponseDto> {
    const claims = await this.verifyAppleClaims(dto);
    return this.loginWithSocialIdentity(claims);
  }

  async loginWithGoogle(dto: GoogleLoginDto): Promise<AuthTokensResponseDto> {
    const claims = await this.verifyGoogleClaims(dto);
    return this.loginWithSocialIdentity(claims);
  }

  async refresh(refreshToken: string): Promise<AuthTokensResponseDto> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const user = await this.prismaService.user.findUnique({
      where: { id: payload.sub },
      select: {
        ...this.userSelect,
        refreshTokenHash: true,
      },
    });

    if (!user?.refreshTokenHash) {
      throw new AuthException(HttpStatus.UNAUTHORIZED, AuthErrorCode.INVALID_CREDENTIALS, {
        message: 'Refresh token is invalid.',
      });
    }
    this.assertUserCanAuthenticate(user);

    const isValid = await compare(refreshToken, user.refreshTokenHash);
    if (!isValid) {
      throw new AuthException(HttpStatus.UNAUTHORIZED, AuthErrorCode.INVALID_CREDENTIALS, {
        message: 'Refresh token is invalid.',
      });
    }

    return this.issueTokens(user);
  }

  async logout(userId: string): Promise<void> {
    await this.prismaService.user.update({
      where: { id: userId },
      data: {
        refreshTokenHash: null,
      },
    });
  }

  private async loginWithSocialIdentity(
    claims: SocialIdentityClaims,
  ): Promise<AuthTokensResponseDto> {
    const existingIdentity = await this.prismaService.authIdentity.findUnique({
      where: {
        provider_providerUserId: {
          provider: claims.provider,
          providerUserId: claims.providerUserId,
        },
      },
      include: {
        user: {
          select: this.userSelect,
        },
      },
    });

    if (existingIdentity) {
      this.assertUserCanAuthenticate(existingIdentity.user, claims.provider);
      return this.issueTokens(existingIdentity.user, {
        identityId: existingIdentity.id,
        provider: claims.provider,
      });
    }

    if (claims.email) {
      await this.assertNoEmailConflict(
        claims.email,
        claims.provider,
        claims.providerUserId,
      );
    }

    const now = new Date();
    const userEmail = this.resolveUserEmail(claims);
    const nickname = this.buildInitialNickname(claims.provider);

    try {
      const created = await this.prismaService.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email: userEmail,
            nickname,
            status: UserStatus.ACTIVE,
            powerProfile: {
              create: {
                version: 'v1',
              },
            },
          },
          select: this.userSelect,
        });

        const identity = await tx.authIdentity.create({
          data: {
            userId: user.id,
            provider: claims.provider,
            providerUserId: claims.providerUserId,
            email: claims.email,
            lastLoginAt: now,
          },
          select: { id: true },
        });

        return {
          user,
          identityId: identity.id,
        };
      });

      return this.issueTokens(created.user, {
        identityId: created.identityId,
        provider: claims.provider,
      });
    } catch (error) {
      await this.rethrowCreateConflict(error, claims);
      throw error;
    }
  }

  private async assertNoEmailConflict(
    email: string,
    requestedProvider: AuthProvider,
    requestedProviderUserId: string,
  ): Promise<void> {
    const identities = await this.prismaService.authIdentity.findMany({
      where: { email },
      select: {
        provider: true,
        providerUserId: true,
      },
    });

    const conflictingIdentities = identities.filter(
      (identity) =>
        identity.provider !== requestedProvider ||
        identity.providerUserId !== requestedProviderUserId,
    );

    if (conflictingIdentities.length === 0) {
      return;
    }

    throw this.buildProviderConflictException(
      requestedProvider,
      email,
      identities.map((identity) => identity.provider),
    );
  }

  private async assertEmailSignupAvailable(email: string): Promise<void> {
    const availableProviders = await this.findAvailableProvidersByEmail(email);
    this.logSignupDebug('email_duplicate_check', {
      email,
      availableProviders,
    });
    if (availableProviders.length === 0) {
      return;
    }

    if (availableProviders.includes(AuthProvider.EMAIL)) {
      throw new AuthException(HttpStatus.CONFLICT, AuthErrorCode.EMAIL_ALREADY_IN_USE, {
        provider: AuthProvider.EMAIL,
        details: {
          email,
          provider: AuthProvider.EMAIL,
          availableProviders,
          supportedProviders: SUPPORTED_AUTH_PROVIDERS,
        },
      });
    }

    throw this.buildProviderConflictException(AuthProvider.EMAIL, email, availableProviders);
  }

  private async assertNicknameAvailable(nickname: string): Promise<void> {
    const existingUser = await this.prismaService.user.findUnique({
      where: { nickname },
      select: { id: true },
    });
    this.logSignupDebug('nickname_duplicate_check', {
      nickname,
      exists: Boolean(existingUser),
    });

    if (!existingUser) {
      return;
    }

    throw new AuthException(HttpStatus.CONFLICT, AuthErrorCode.NICKNAME_ALREADY_IN_USE, {
      provider: AuthProvider.EMAIL,
      details: {
        nickname,
        provider: AuthProvider.EMAIL,
        supportedProviders: SUPPORTED_AUTH_PROVIDERS,
      },
    });
  }

  private buildProviderConflictException(
    requestedProvider: AuthProvider,
    email: string,
    availableProviders: Iterable<AuthProvider>,
  ): AuthException {
    return new AuthException(HttpStatus.CONFLICT, AuthErrorCode.PROVIDER_CONFLICT, {
      provider: requestedProvider,
      details: {
        email,
        provider: requestedProvider,
        availableProviders: normalizeAuthProviders(availableProviders),
        supportedProviders: SUPPORTED_AUTH_PROVIDERS,
      },
    });
  }

  private async findAvailableProvidersByEmail(email: string): Promise<AuthProvider[]> {
    const identities = await this.prismaService.authIdentity.findMany({
      where: { email },
      select: {
        provider: true,
      },
    });

    return normalizeAuthProviders(identities.map((identity) => identity.provider));
  }

  private async verifyAppleClaims(dto: AppleLoginDto): Promise<SocialIdentityClaims> {
    try {
      const claims = await this.appleIdentityTokenVerifierService.verifyIdentityToken(
        dto.identityToken,
      );

      return {
        provider: AuthProvider.APPLE,
        providerUserId: claims.sub,
        email: claims.email ? this.normalizeEmail(claims.email) : null,
      };
    } catch (error) {
      this.rethrowSocialTokenError(error, AuthProvider.APPLE);
    }
  }

  private async verifyGoogleClaims(dto: GoogleLoginDto): Promise<SocialIdentityClaims> {
    try {
      const claims = await this.googleIdentityTokenVerifierService.verifyIdentityToken(
        dto.identityToken,
      );

      return {
        provider: AuthProvider.GOOGLE,
        providerUserId: claims.sub,
        email:
          claims.email && claims.emailVerified ? this.normalizeEmail(claims.email) : null,
      };
    } catch (error) {
      this.rethrowSocialTokenError(error, AuthProvider.GOOGLE);
    }
  }

  private rethrowSocialTokenError(error: unknown, provider: AuthProvider): never {
    if (error instanceof HttpException && error.getStatus() >= 500) {
      throw error;
    }

    if (error instanceof HttpException) {
      throw new AuthException(HttpStatus.UNAUTHORIZED, AuthErrorCode.SOCIAL_TOKEN_INVALID, {
        provider,
        message: error.message,
        details: {
          provider,
          supportedProviders: SUPPORTED_AUTH_PROVIDERS,
        },
      });
    }

    throw new AuthException(HttpStatus.UNAUTHORIZED, AuthErrorCode.SOCIAL_TOKEN_INVALID, {
      provider,
      details: {
        provider,
        supportedProviders: SUPPORTED_AUTH_PROVIDERS,
      },
    });
  }

  private async rethrowEmailSignupConflict(
    error: unknown,
    email: string,
    nickname: string,
  ): Promise<void> {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      await this.assertEmailSignupAvailable(email);
      await this.assertNicknameAvailable(nickname);

      throw new AuthException(HttpStatus.CONFLICT, AuthErrorCode.EMAIL_ALREADY_IN_USE, {
        provider: AuthProvider.EMAIL,
        details: {
          email,
          provider: AuthProvider.EMAIL,
          supportedProviders: SUPPORTED_AUTH_PROVIDERS,
        },
      });
    }
  }

  private async rethrowCreateConflict(
    error: unknown,
    claims: SocialIdentityClaims,
  ): Promise<void> {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      if (claims.email) {
        await this.assertNoEmailConflict(
          claims.email,
          claims.provider,
          claims.providerUserId,
        );
      }

      throw new AuthException(HttpStatus.CONFLICT, AuthErrorCode.PROVIDER_CONFLICT, {
        provider: claims.provider,
        details: {
          provider: claims.provider,
          availableProviders: [claims.provider],
          supportedProviders: SUPPORTED_AUTH_PROVIDERS,
        },
      });
    }
  }

  private async verifyRefreshToken(token: string): Promise<TokenPayload> {
    try {
      const payload = await this.jwtService.verifyAsync<TokenPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('Refresh token type is invalid.');
      }

      return payload;
    } catch {
      throw new AuthException(HttpStatus.UNAUTHORIZED, AuthErrorCode.INVALID_CREDENTIALS, {
        message: 'Refresh token is invalid or expired.',
      });
    }
  }

  private async issueTokens(
    user: UserRecord,
    options: IssueTokensOptions = {},
  ): Promise<AuthTokensResponseDto> {
    this.assertUserCanAuthenticate(user, options.provider ?? undefined);

    const { identityId, provider } = options;
    const accessPayload: TokenPayload = { sub: user.id, email: user.email, type: 'access' };
    const refreshPayload: TokenPayload = {
      sub: user.id,
      email: user.email,
      type: 'refresh',
      jti: randomUUID(),
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(accessPayload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.configService.getOrThrow<string>('JWT_ACCESS_EXPIRES_IN') as any,
      }),
      this.jwtService.signAsync(refreshPayload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.getOrThrow<string>('JWT_REFRESH_EXPIRES_IN') as any,
      }),
    ]);

    const updates: Prisma.PrismaPromise<unknown>[] = [
      this.prismaService.user.update({
        where: { id: user.id },
        data: {
          refreshTokenHash: await hash(refreshToken, PASSWORD_SALT_ROUNDS),
        },
      }),
    ];

    if (identityId) {
      updates.push(
        this.prismaService.authIdentity.update({
          where: { id: identityId },
          data: {
            lastLoginAt: new Date(),
          },
        }),
      );
    }

    await this.prismaService.$transaction(updates);

    const resolvedProvider = provider ?? (await this.resolveLatestProvider(user.id));

    return {
      user: this.toAuthUser(user, resolvedProvider),
      accessToken,
      refreshToken,
    };
  }

  private toAuthUser(
    user: UserRecord,
    provider?: AuthProvider | null,
  ): AuthUserResponseDto {
    return {
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      provider: toAuthProviderResponse(provider),
      status: user.status,
    };
  }

  private async resolveLatestProvider(userId: string): Promise<AuthProvider | null> {
    const latestIdentity = await this.prismaService.authIdentity.findFirst({
      where: { userId },
      orderBy: [{ lastLoginAt: 'desc' }, { linkedAt: 'desc' }],
      select: {
        provider: true,
      },
    });

    return latestIdentity?.provider ?? null;
  }

  private assertUserCanAuthenticate(
    user: UserRecord,
    provider?: AuthProvider | null,
  ): void {
    if (user.status === UserStatus.ACTIVE) {
      return;
    }

    throw new AuthException(HttpStatus.FORBIDDEN, AuthErrorCode.ACCOUNT_UNAVAILABLE, {
      provider: provider ?? undefined,
      message: 'Only active accounts can authenticate.',
      details: {
        userId: user.id,
        status: user.status,
      },
    });
  }

  private assertValidEmail(email: string): void {
    if (isEmail(email)) {
      return;
    }

    throw new AuthException(HttpStatus.BAD_REQUEST, AuthErrorCode.INVALID_EMAIL_FORMAT, {
      provider: AuthProvider.EMAIL,
      details: {
        provider: AuthProvider.EMAIL,
        supportedProviders: SUPPORTED_AUTH_PROVIDERS,
      },
    });
  }

  private assertStrongPassword(password: string): void {
    if (
      password.length >= PASSWORD_MIN_LENGTH &&
      PASSWORD_STRENGTH_PATTERN.test(password)
    ) {
      return;
    }

    throw new AuthException(HttpStatus.BAD_REQUEST, AuthErrorCode.WEAK_PASSWORD, {
      provider: AuthProvider.EMAIL,
      message: 'Password must be at least 8 characters and include letters and numbers.',
      details: {
        provider: AuthProvider.EMAIL,
        supportedProviders: SUPPORTED_AUTH_PROVIDERS,
      },
    });
  }

  private assertRequiredTerms(dto: EmailSignupDto): void {
    if (dto.agreedToTerms && dto.agreedToPrivacy) {
      return;
    }

    throw new AuthException(
      HttpStatus.BAD_REQUEST,
      AuthErrorCode.REQUIRED_TERMS_NOT_AGREED,
      {
        provider: AuthProvider.EMAIL,
        details: {
          provider: AuthProvider.EMAIL,
          required: ['agreedToTerms', 'agreedToPrivacy'],
          supportedProviders: SUPPORTED_AUTH_PROVIDERS,
        },
      },
    );
  }

  private normalizeEmail(email: string): string {
    return (email ?? '').trim().toLowerCase();
  }

  private normalizeNickname(nickname: string): string {
    return (nickname ?? '').trim();
  }

  private resolveUserEmail(claims: SocialIdentityClaims): string {
    return (
      claims.email ??
      `${claims.provider.toLowerCase()}-${claims.providerUserId}@no-email.auth.local`
    );
  }

  private buildInitialNickname(provider: AuthProvider): string {
    return `user-${provider.toLowerCase()}-${randomUUID().slice(0, 8)}`;
  }

  private shouldLogSignupDebug(): boolean {
    return resolveNodeEnv(this.configService.get<string>('NODE_ENV')) === 'development';
  }

  private logSignupDebug(event: string, details: Record<string, unknown>): void {
    if (!this.shouldLogSignupDebug()) {
      return;
    }

    this.logger.debug(`[signup/email] ${event} ${JSON.stringify(details)}`);
  }

  private resolveErrorCode(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }

      const code = (response as Record<string, unknown>).code;
      if (typeof code === 'string') {
        return code;
      }
    }

    return AuthErrorCode.INTERNAL_SERVER_ERROR;
  }

  private resolveStatusCode(error: unknown): number {
    return error instanceof HttpException
      ? error.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private resolveErrorMessage(error: unknown): string {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      if (typeof response === 'string') {
        return response;
      }

      const message = (response as Record<string, unknown>).message;
      if (typeof message === 'string') {
        return message;
      }
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Internal server error';
  }
}
