import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, KeyObject } from 'node:crypto';
import jwt, { JsonWebTokenError, JwtHeader, JwtPayload, TokenExpiredError } from 'jsonwebtoken';
import { firstValueFrom } from 'rxjs';

interface AppleKeysResponse {
  keys: AppleJwk[];
}

interface AppleJwk extends Record<string, unknown> {
  kid?: string;
  alg?: string;
  use?: string;
}

interface VerifiedAppleIdentity {
  sub: string;
  email?: string;
  emailVerified?: boolean;
}

@Injectable()
export class AppleIdentityTokenVerifierService {
  private readonly issuer = 'https://appleid.apple.com';
  private readonly cacheTtlMs = 1000 * 60 * 60 * 6;
  private readonly keyCache = new Map<string, { publicKey: KeyObject; expiresAt: number }>();

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  async verifyIdentityToken(identityToken: string): Promise<VerifiedAppleIdentity> {
    const audience =
      this.configService.get<string>('APPLE_CLIENT_ID') ??
      this.configService.get<string>('APPLE_AUDIENCE');

    if (!audience) {
      throw new ServiceUnavailableException('Apple login audience is not configured.');
    }

    const decoded = jwt.decode(identityToken, { complete: true });
    if (!decoded || typeof decoded !== 'object' || !('header' in decoded)) {
      throw new BadRequestException('Apple identity token is malformed.');
    }

    const header = decoded.header as JwtHeader;
    if (!header.kid) {
      throw new BadRequestException('Apple identity token is missing key id.');
    }

    if (header.alg !== 'RS256') {
      throw new UnauthorizedException('Apple identity token algorithm is invalid.');
    }

    const publicKey = await this.getApplePublicKey(header.kid);

    try {
      const payload = jwt.verify(identityToken, publicKey, {
        algorithms: ['RS256'],
        issuer: this.issuer,
        audience,
      }) as JwtPayload;

      if (!payload.sub) {
        throw new BadRequestException('Apple identity token subject is missing.');
      }

      return {
        sub: String(payload.sub),
        email: typeof payload.email === 'string' ? payload.email : undefined,
        emailVerified:
          typeof payload.email_verified === 'boolean'
            ? payload.email_verified
            : payload.email_verified === 'true',
      };
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new UnauthorizedException('Apple identity token expired.');
      }

      if (error instanceof JsonWebTokenError) {
        if (error.message.includes('jwt audience invalid')) {
          throw new UnauthorizedException('Apple identity token audience is invalid.');
        }
        if (error.message.includes('jwt issuer invalid')) {
          throw new UnauthorizedException('Apple identity token issuer is invalid.');
        }
        if (error.message.includes('invalid signature')) {
          throw new UnauthorizedException('Apple identity token signature is invalid.');
        }

        throw new UnauthorizedException('Apple identity token verification failed.');
      }

      throw error;
    }
  }

  private async getApplePublicKey(kid: string): Promise<KeyObject> {
    const cached = this.keyCache.get(kid);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.publicKey;
    }

    const response = await firstValueFrom(
      this.httpService.get<AppleKeysResponse>('https://appleid.apple.com/auth/keys', {
        timeout: 5000,
      }),
    ).catch(() => {
      throw new ServiceUnavailableException('Unable to fetch Apple public keys.');
    });

    for (const jwk of response.data.keys ?? []) {
      if (!jwk.kid) {
        continue;
      }

      const publicKey = createPublicKey({
        key: jwk as any,
        format: 'jwk',
      });
      this.keyCache.set(jwk.kid, {
        publicKey,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
    }

    const matched = this.keyCache.get(kid);
    if (!matched) {
      throw new UnauthorizedException('Apple identity token key id is unknown.');
    }

    return matched.publicKey;
  }
}
