import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AuthenticatedUser } from '../common/interfaces/authenticated-request.interface';
import { PrismaService } from '../prisma/prisma.service';
import { AuthErrorCode } from './auth-error-code';
import { AuthException } from './auth.exception';

interface JwtPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      ignoreExpiration: false,
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload.type !== 'access') {
      throw new AuthException(HttpStatus.UNAUTHORIZED, AuthErrorCode.AUTH_REQUIRED, {
        message: 'Access token is required.',
      });
    }

    const user = await this.prismaService.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        status: true,
      },
    });

    if (!user) {
      throw new AuthException(HttpStatus.UNAUTHORIZED, AuthErrorCode.AUTH_REQUIRED, {
        message: 'Authentication is required.',
      });
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new AuthException(HttpStatus.FORBIDDEN, AuthErrorCode.ACCOUNT_UNAVAILABLE, {
        message: 'Only active accounts can access this resource.',
        details: {
          userId: user.id,
          status: user.status,
        },
      });
    }

    return {
      userId: user.id,
      email: user.email,
    };
  }
}
