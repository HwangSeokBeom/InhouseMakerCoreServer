import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { PrismaService } from '../prisma/prisma.service';
import { AppleLoginDto, AuthTokensResponseDto, SignupDto } from './dto/signup.dto';

interface TokenPayload {
  sub: string;
  email: string;
  type: 'access' | 'refresh';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async signup(dto: SignupDto): Promise<AuthTokensResponseDto> {
    const existingUser = await this.prismaService.user.findFirst({
      where: {
        OR: [{ email: dto.email }, ...(dto.appleSub ? [{ appleSub: dto.appleSub }] : [])],
      },
    });

    if (existingUser) {
      throw new ConflictException('A user with this email or Apple account already exists.');
    }

    const passwordHash = await hash(dto.password, 10);
    const user = await this.prismaService.user.create({
      data: {
        email: dto.email,
        passwordHash,
        appleSub: dto.appleSub,
        nickname: dto.nickname,
        powerProfile: {
          create: {
            version: 'v1',
          },
        },
      },
    });

    return this.issueTokens(user.id, user.email, user.nickname);
  }

  async loginWithApple(dto: AppleLoginDto): Promise<AuthTokensResponseDto> {
    const claims = this.decodeAppleIdentityToken(dto.identityToken);
    const email = claims.email ?? `apple-${claims.sub}@private.appleid.local`;

    let user = await this.prismaService.user.findFirst({
      where: {
        OR: [{ appleSub: claims.sub }, { email }],
      },
    });

    if (!user) {
      user = await this.prismaService.user.create({
        data: {
          email,
          appleSub: claims.sub,
          nickname: dto.nickname ?? claims.nickname ?? `user-${claims.sub.slice(0, 6)}`,
          powerProfile: {
            create: {
              version: 'v1',
            },
          },
        },
      });
    } else if (!user.appleSub) {
      user = await this.prismaService.user.update({
        where: { id: user.id },
        data: {
          appleSub: claims.sub,
          nickname: dto.nickname ?? user.nickname,
        },
      });
    }

    return this.issueTokens(user.id, user.email, user.nickname);
  }

  async refresh(refreshToken: string): Promise<AuthTokensResponseDto> {
    const payload = await this.verifyRefreshToken(refreshToken);
    const user = await this.prismaService.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user?.refreshTokenHash) {
      throw new UnauthorizedException('Refresh token is invalid.');
    }

    const isValid = await compare(refreshToken, user.refreshTokenHash);
    if (!isValid) {
      throw new UnauthorizedException('Refresh token is invalid.');
    }

    return this.issueTokens(user.id, user.email, user.nickname);
  }

  private decodeAppleIdentityToken(token: string): {
    sub: string;
    email?: string;
    nickname?: string;
  } {
    const decoded = jwt.decode(token);

    if (!decoded || typeof decoded !== 'object' || !('sub' in decoded)) {
      throw new BadRequestException('Invalid Apple identity token.');
    }

    return {
      sub: String(decoded.sub),
      email: typeof decoded.email === 'string' ? decoded.email : undefined,
      nickname:
        typeof decoded.name === 'string'
          ? decoded.name
          : typeof decoded.nickname === 'string'
            ? decoded.nickname
            : undefined,
    };
  }

  private async verifyRefreshToken(token: string): Promise<TokenPayload> {
    try {
      return await this.jwtService.verifyAsync<TokenPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Refresh token is invalid or expired.');
    }
  }

  private async issueTokens(
    userId: string,
    email: string,
    nickname: string,
  ): Promise<AuthTokensResponseDto> {
    const accessPayload: TokenPayload = { sub: userId, email, type: 'access' };
    const refreshPayload: TokenPayload = { sub: userId, email, type: 'refresh' };

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

    await this.prismaService.user.update({
      where: { id: userId },
      data: {
        refreshTokenHash: await hash(refreshToken, 10),
      },
    });

    return {
      user: {
        id: userId,
        email,
        nickname,
      },
      accessToken,
      refreshToken,
    };
  }
}
